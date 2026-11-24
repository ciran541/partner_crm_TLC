/**
 * Revisit — the next refinancing cycle for a client the agent has closed before.
 *
 * A Closed Won case is NEVER reopened: its closure and the commission paid on it
 * stay exactly as they were. When its follow-up date arrives, the agent taps
 * "Revisit" and a NEW Refinancing case is created, active (so it counts in
 * Potential Revenue straight away), linked to the closed one by parent_case_id.
 * Following those links is the client's journey: 2025 refi → 2027 refi → …
 *
 * Everything the agent captured at closing is carried forward so the new case
 * starts filled in: the projected outstanding loan (amortised to today on the
 * closed package), remaining tenure, the bank now holding the loan, when the
 * new lock-in ends, property details, and borrowers (ages moved forward).
 *
 * Closed Lost cases can be revisited too (same follow-up-date rule): lose a
 * client today, set a follow-up two years out, and try again then. A lost case
 * has no closure to project from, so the new case carries forward what the agent
 * had already entered (loan, bank, workflow answers) and keeps the SAME case type
 * — it's another attempt at the same deal, not the next refinance after a win.
 *
 * Pure — tested in __tests__/revisit.test.ts. The API route
 * (/api/insurance/cases/[id]/revisit) enforces the same gate server-side.
 */

import { computeAmortization } from '@/lib/insurance/amortCalc'
import type { SoraRates } from '@/lib/insurance/sora'
import { caseLockInEnd } from '@/lib/insurance/followUps'
import type { Case, ClosedWonData, ClosedWonLoan } from '@/lib/types'

// ─── Gate ────────────────────────────────────────────────────────────────────

export type RevisitGate =
    | { ok: true }
    | { ok: false; reason: 'not_closed' | 'already_revisited' | 'no_follow_up' | 'too_early'; message: string; unlocksOn?: string }

/** Stages a client can be revisited from. */
export const REVISITABLE_STAGES = ['Closed Won', 'Closed Lost'] as const
export function isRevisitable(stage: string | null | undefined): boolean {
    return (REVISITABLE_STAGES as readonly string[]).includes(stage ?? '')
}

/**
 * Revisit opens on the follow-up date, not before — so a just-closed client
 * can't be flipped straight back into the pipeline (and back into revenue).
 * `today` is a YYYY-MM-DD SGT date (todaySgt()).
 */
export function revisitGate(
    c: Pick<Case, 'stage' | 'follow_up_date'>,
    today: string,
    childId?: string | null,
): RevisitGate {
    if (!isRevisitable(c.stage)) return { ok: false, reason: 'not_closed', message: 'Only a Closed Won or Closed Lost case can be revisited.' }
    if (childId) return { ok: false, reason: 'already_revisited', message: 'This case has already been revisited.' }
    if (!c.follow_up_date) return { ok: false, reason: 'no_follow_up', message: 'Set a follow-up date first — Revisit opens on that date.' }
    if (today < c.follow_up_date) return { ok: false, reason: 'too_early', message: 'Revisit opens on the follow-up date.', unlocksOn: c.follow_up_date }
    return { ok: true }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HOME_KINDS = new Set(['home', 'refi_home', 'new_purchase_home'])

/** Whole years from `from` to `to` (both YYYY-MM-DD). */
export function yearsBetween(from: string, to: string): number {
    const [fy, fm, fd] = from.split('-').map(Number)
    const [ty, tm, td] = to.split('-').map(Number)
    let y = ty - fy
    if (tm < fm || (tm === fm && td < fd)) y--
    return Math.max(0, y)
}

/** The bank holding the loan after this close. */
export function closingBank(c: Pick<Case, 'closed_won_data' | 'referred_bankers'>): string | undefined {
    const recorded = c.closed_won_data?.bank?.trim()
    if (recorded) return recorded
    // Older closures didn't record it — only trust the referral when it's unambiguous.
    const bankers = c.referred_bankers ?? []
    const banks = [...new Set(bankers.map(b => b.bank).filter(Boolean))]
    return banks.length === 1 ? banks[0] : undefined
}

/** One loan's balance after `years` on the closed package (null if not computable, e.g. SORA unknown). */
function balanceAfter(loan: ClosedWonLoan, cw: ClosedWonData, years: number, sora: SoraRates | null): number | null {
    const schedule = cw.package?.schedule ?? []
    if (!loan.amount || !loan.tenure || !schedule.length || years <= 0) return null
    if (years >= loan.tenure) return 0
    const row = computeAmortization(loan.amount, loan.tenure, schedule, sora).find(r => r.year === years)
    return row?.balance ?? null
}

/** Refinancing-workflow property type from whatever the closed case's workflow held. */
function refiPropertyType(caseType: Case['case_type'], wfType: unknown): string | undefined {
    if (typeof wfType !== 'string') return undefined
    if (caseType === 'Refinancing' || caseType === 'Equity Loan') return wfType   // same vocabulary
    const map: Record<string, string> = {
        resale_hdb: 'hdb', bto: 'hdb', resale_landed: 'landed', landed: 'landed',
        resale_condo: 'completed_condo', completed_condo: 'completed_condo',
    }
    return map[wfType]
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export interface RevisitEstimate {
    outstanding: number | null
    years: number                   // years on the closed package so far
    bank?: string
    lockInEnd?: string
}

/** Workflow answers that belong to the previous attempt only — never carried into a revisit. */
const ATTEMPT_ONLY_KEYS = new Set([
    'selected_package_snapshot', 'promo_snapshot', 'next_actions_done', 'documents_done',
    'completed_steps', 'agent_notes', 'flags', 'ipa', 'ipa_done',
])

/** Borrowers carried forward with their ages moved on by `years`. */
function agedBorrowers(borrowers: unknown, years: number): Record<string, unknown>[] | undefined {
    if (!Array.isArray(borrowers)) return undefined
    return (borrowers as Record<string, unknown>[]).map(b => ({
        ...b,
        ...(typeof b.age === 'number' && b.age > 0 ? { age: b.age + years } : {}),
    }))
}

/**
 * Revisit of a Closed Lost case: same case type, the agent's own figures and
 * workflow answers carried forward (minus the previous attempt's package choice,
 * checklists and notes), remaining tenure and borrower ages moved on.
 */
function buildLostRevisit(parent: Case, today: string) {
    // No closing date is stored for a lost case; its last update is the closest.
    const lostOn = (parent.updated_at ?? parent.created_at ?? today).slice(0, 10)
    const years = yearsBetween(lostOn, today)

    const pwf = (parent.workflow_data ?? {}) as Record<string, unknown>
    const wf: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(pwf)) if (!ATTEMPT_ONLY_KEYS.has(k)) wf[k] = v
    const borrowers = agedBorrowers(pwf.borrowers, years)
    if (borrowers) wf.borrowers = borrowers
    for (const k of ['current_tenure', 'current_equity_loan_tenure', 'current_tenure_equity_loan']) {
        if (typeof pwf[k] === 'number') wf[k] = Math.max(0, (pwf[k] as number) - years) || undefined
    }
    // A lock-in date that has already passed no longer describes the client's loan.
    for (const k of ['lockin_end_date']) {
        if (typeof pwf[k] === 'string' && (pwf[k] as string) < today) delete wf[k]
    }
    const lockIn = parent.lock_in_end_date && parent.lock_in_end_date >= today ? parent.lock_in_end_date : null

    const outstanding = parent.existing_loan_amount ?? parent.loan_size ?? null
    const reason = parent.closed_lost_reason?.trim()
    const remarks = `Revisit of the ${parent.case_type} case marked Closed Lost${reason ? ` (reason: ${reason})` : ''}.`

    const estimate: RevisitEstimate = { outstanding, years, bank: parent.current_bank ?? undefined, lockInEnd: lockIn ?? undefined }
    return {
        estimate,
        row: {
            case_type: parent.case_type,
            stage: 'Touched Base' as const,
            client_name: parent.client_name ?? null,
            client_mobile: parent.client_mobile ?? null,
            client_email: parent.client_email ?? null,
            property_type: parent.property_type ?? null,
            property_price: parent.property_price ?? null,
            property_address: parent.property_address ?? null,
            current_bank: parent.current_bank ?? null,
            existing_loan_amount: parent.existing_loan_amount ?? null,
            loan_size: parent.loan_size ?? null,
            lock_in_end_date: lockIn,
            referred_bankers: [],
            remarks,
            workflow_data: wf,
        },
    }
}

/**
 * The new case's row (minus created_by / parent_case_id, which the route sets).
 * `today` = YYYY-MM-DD SGT; `sora` = current rates for floating packages.
 */
export function buildRevisitCase(parent: Case, today: string, sora: SoraRates | null) {
    if (parent.stage === 'Closed Lost') return buildLostRevisit(parent, today)
    const cw: ClosedWonData = parent.closed_won_data ?? {}
    const loans = (cw.loans ?? []).filter(l => l.amount > 0 && l.tenure > 0)
    const lockin = cw.package?.lockin_years ?? 0
    // Time on the closed package. Older closures have no closed_at — a revisit
    // happens around lock-in end, so the lock-in length is the best stand-in.
    const years = cw.closed_at ? yearsBetween(cw.closed_at, today) : lockin

    // Outstanding per loan, amortised to today. If a balance can't be computed
    // (e.g. floating package and no SORA), fall back to the projection stored at
    // closing, split by original amount.
    const balances = loans.map(l => balanceAfter(l, cw, years, sora))
    const allKnown = balances.length > 0 && balances.every(b => b != null)
    const original = loans.reduce((s, l) => s + l.amount, 0)
    const share = (l: ClosedWonLoan) => (original > 0 && cw.combined_outstanding ? cw.combined_outstanding * (l.amount / original) : null)
    const perLoan = loans.map((l, i) => ({ loan: l, balance: allKnown ? balances[i]! : share(l) }))

    const sum = (pred: (k: string) => boolean) => {
        const xs = perLoan.filter(p => pred(p.loan.kind) && p.balance != null)
        return xs.length ? Math.round(xs.reduce((s, p) => s + p.balance!, 0)) : undefined
    }
    const homeBal = sum(k => HOME_KINDS.has(k))
    const equityBal = sum(k => k === 'equity')
    const total = (homeBal ?? 0) + (equityBal ?? 0) > 0
        ? (homeBal ?? 0) + (equityBal ?? 0)
        : cw.combined_outstanding ?? cw.original_loan_total ?? parent.existing_loan_amount ?? parent.loan_size ?? null

    const remaining = (pred: (k: string) => boolean) => {
        const l = loans.find(x => pred(x.kind))
        return l ? Math.max(0, l.tenure - years) || undefined : undefined
    }
    const homeTenure = remaining(k => HOME_KINDS.has(k))
    const equityTenure = remaining(k => k === 'equity')

    const lockInEnd = caseLockInEnd(parent) ?? undefined
    const thereafter = (cw.package?.schedule ?? []).find(e => e.thereafter)
    const rateAfterLockin = thereafter?.type === 'fixed' && thereafter.rate != null ? thereafter.rate : undefined
    const bank = closingBank(parent)

    // Workflow: carry forward what's still true about the client and property.
    const pwf = (parent.workflow_data ?? {}) as Record<string, unknown>
    const wf: Record<string, unknown> = {}
    const set = (k: string, v: unknown) => { if (v !== undefined && v !== null && v !== '') wf[k] = v }
    set('current_bank', bank)
    set('outstanding_disbursed', homeBal ?? (equityBal == null ? total ?? undefined : undefined))
    set('outstanding_equity_loan', equityBal)
    set('lockin_end_date', lockInEnd)
    set('current_tenure', homeTenure)
    set('current_equity_loan_tenure', equityTenure)
    set('current_rate', rateAfterLockin)
    set('property_type', refiPropertyType(parent.case_type, pwf.property_type))
    for (const k of ['property_use', 'year_of_purchase', 'market_price', 'priority_client', 'priority_banks', 'provide_income']) set(k, pwf[k])
    const borrowers = agedBorrowers(pwf.borrowers, years)
    if (borrowers) wf.borrowers = borrowers

    const money = (n: number) => `$${Math.round(n).toLocaleString('en-SG')}`
    const closedOn = cw.closed_at ? new Date(`${cw.closed_at}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null
    const remarks = [
        `Revisit of the ${parent.case_type} case closed${closedOn ? ` on ${closedOn}` : ''}${bank ? ` with ${bank}` : ''}`
        + `${cw.original_loan_total ? ` (${money(cw.original_loan_total)})` : ''}.`,
    ].join('')

    const estimate: RevisitEstimate = { outstanding: total, years, bank, lockInEnd }

    return {
        estimate,
        row: {
            case_type: 'Refinancing' as Case['case_type'],
            stage: 'Touched Base' as const,
            client_name: parent.client_name ?? null,
            client_mobile: parent.client_mobile ?? null,
            client_email: parent.client_email ?? null,
            property_type: parent.property_type ?? null,
            property_price: parent.property_price ?? null,
            property_address: parent.property_address ?? cw.property_address ?? null,
            current_bank: bank ?? null,
            existing_loan_amount: total,
            loan_size: null as number | null,
            lock_in_end_date: lockInEnd ?? null,
            referred_bankers: [],
            remarks,
            workflow_data: wf,
        },
    }
}
