/**
 * Equity Loan client document + the shared equity summary it's built from.
 *
 * The equity maths lives inline in EquityLoanWorkflow.tsx; this extracts the
 * report-relevant figures into one pure function so the on-screen presentation and
 * the emailed PDF compute the SAME numbers (single source of truth). Composes the
 * shared presentation engine (presentationShell.ts).
 */

import type { EquityLoanWorkflow } from '@/lib/types/workflow'
import type { SoraRates } from '@/lib/insurance/sora'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import { packageStyle } from '@/lib/insurance/rateFilters'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import type { RateScheduleEntry } from '@/lib/types/rates'
import {
    renderPresentation, section, packageCard, instalmentBreakdown, kvTable, notesBlock,
    money, type CoverStat,
} from '@/lib/insurance/presentationShell'

const EL_PROPERTY_LABELS: Record<string, string> = {
    landed: 'Landed',
    completed_condo: 'Completed Condo',
    completed_ec_mop: 'Completed EC (MOP obtained)',
}

export interface EquitySummary {
    valuation: number
    outstandingLoan: number
    cpfUsed: number
    fullyPaid: boolean
    loanPct: number
    cpfPctOfVal: number
    equityPct: number
    equityHeadroom: number       // max equity loan within 75% LTV
    eligible: boolean            // headroom ≥ $50k
    cashPct: number
    tenureMax: number            // years
    requestedAmount: number
}

/** Equity figures used by the report — mirrors EquityLoanWorkflow.tsx. Tenure uses a
 *  simple average-age cap (no IWAA), matching the no-income case. */
export function computeEquitySummary(wf: EquityLoanWorkflow): EquitySummary {
    const valuation = wf.market_price ?? 0
    const outstandingLoan = (wf.outstanding_disbursed ?? 0) + (wf.outstanding_equity_loan ?? 0)
    const cpfUsed = wf.cpf_used ?? 0
    const fullyPaid = !!wf.fully_paid

    const loanPct = valuation > 0 ? (fullyPaid ? 0 : outstandingLoan) / valuation : 0
    const cpfPctOfVal = valuation > 0 ? cpfUsed / valuation : 0
    const equityPct = Math.max(0, 0.75 - loanPct - cpfPctOfVal)
    const equityHeadroom = equityPct * valuation
    const eligible = equityHeadroom >= 50_000
    const cashPct = Math.max(0, 1 - loanPct - cpfPctOfVal)

    const ages = (wf.borrowers ?? []).map(b => b.age ?? 0).filter(a => a > 0)
    const avgAge = ages.length ? ages.reduce((s, a) => s + a, 0) / ages.length : null
    const tenureMax = avgAge != null ? Math.max(5, Math.min(35, 75 - Math.ceil(avgAge))) : 35

    return {
        valuation, outstandingLoan, cpfUsed, fullyPaid, loanPct, cpfPctOfVal,
        equityPct, equityHeadroom, eligible, cashPct, tenureMax,
        requestedAmount: wf.equity_loan_amount ?? 0,
    }
}

export interface EquityPresentationData {
    clientName?: string
    advisorName?: string
    workflow: EquityLoanWorkflow
    sora?: SoraRates | null
    autoPrint?: boolean
}

export function buildEquityLoanPresentationHtml(d: EquityPresentationData): string {
    const wf = d.workflow
    const s = computeEquitySummary(wf)
    const propertyLabel = EL_PROPERTY_LABELS[wf.property_type ?? ''] ?? 'Property'
    const sections: string[] = []

    // ── Equity loan headroom ──
    const headroomRows = [
        { label: 'Property valuation', value: money(s.valuation) },
        { label: '75% LTV ceiling', value: money(s.valuation * 0.75) },
        ...(s.fullyPaid ? [] : [{ label: 'Outstanding loan', value: money(s.outstandingLoan) }]),
        { label: 'CPF used', value: money(s.cpfUsed) },
        { label: 'Maximum equity loan', value: money(s.equityHeadroom), total: true },
    ]
    const eligibilityNote = s.eligible
        ? ''
        : `<div class="alert">An equity term loan must be at least $50,000. The current headroom of ${money(s.equityHeadroom)} is below the minimum — paying down CPF or waiting for the valuation to rise can unlock it.</div>`
    sections.push(section(
        'Equity loan headroom',
        'The cash you can unlock from your property, within the 75% LTV limit.',
        kvTable(headroomRows) + eligibilityNote,
    ))

    // ── Requested loan + package + instalment ──
    const pkg = wf.selected_package_snapshot as {
        bank?: string; package_name?: string; category?: string; lockin_years?: number
        rate_schedule?: RateScheduleEntry[]; features?: string[]; projected_monthly?: number | null
        year1_rate?: number | null
    } | undefined

    if (s.requestedAmount > 0) {
        sections.push(section(
            'Your equity loan',
            'The amount you’re unlocking and the term we can structure.',
            kvTable([
                { label: 'Requested equity loan', value: money(s.requestedAmount), total: false },
                { label: 'Loan tenure (up to)', value: `${s.tenureMax} years` },
            ]),
        ))

        if (pkg?.bank) {
            const scheduleLines = pkg.rate_schedule?.length
                ? formatRateSchedule(pkg.rate_schedule)
                : pkg.year1_rate != null ? [`Year 1: ${pkg.year1_rate.toFixed(2)}%`] : []
            const style = pkg.lockin_years != null && pkg.features
                ? packageStyle({ lockin_years: pkg.lockin_years, features: pkg.features })
                : null
            sections.push(section(
                'Recommended package',
                'The package best matched to your equity loan.',
                packageCard({
                    bank: pkg.bank, package_name: pkg.package_name, category: pkg.category, lockin_years: pkg.lockin_years,
                    scheduleLines, style, features: pkg.features, projected_monthly: pkg.projected_monthly,
                }),
            ))

            if (pkg.rate_schedule?.length) {
                const rows = computeAmortization(s.requestedAmount, s.tenureMax, pkg.rate_schedule, d.sora ?? null)
                const breakdown = instalmentBreakdown({ rows, lockinYears: pkg.lockin_years, monthly: pkg.projected_monthly, tenureYears: s.tenureMax })
                if (breakdown) {
                    sections.push(section(
                        'Monthly instalment & interest',
                        'Your estimated instalment and the interest you’d pay during the lock-in.',
                        breakdown,
                    ))
                }
            }
        }
    }

    // ── Key things to note ──
    const notes = [
        'An equity term loan lets you borrow against your property’s value, up to 75% LTV less the outstanding loan and CPF used.',
        'The minimum equity loan is $50,000; the maximum depends on the latest bank valuation.',
        'Monthly instalments are estimates at today’s SORA — actual rates are subject to the bank’s assessment.',
        'All figures are for discussion only and are not a formal offer of credit.',
    ]
    sections.push(section('Key things to note', undefined, notesBlock([], notes)))

    const coverStats: CoverStat[] = [
        { label: 'Property', value: propertyLabel },
        { label: 'Valuation', value: money(s.valuation) },
        { label: 'Max equity loan', value: money(s.equityHeadroom) },
        ...(s.requestedAmount > 0 ? [{ label: 'Requested', value: money(s.requestedAmount) }] : []),
    ]

    return renderPresentation({
        planLabel: 'Equity Loan Plan',
        docTitle: `Equity Loan Plan${d.clientName ? ` — ${d.clientName}` : ''}`,
        heading: d.clientName ? `Prepared for ${d.clientName}` : 'Your equity loan summary',
        advisorName: d.advisorName,
        coverStats,
        bodyHtml: sections.join('\n'),
        disclaimer: 'All figures are estimates for discussion only and are subject to the bank’s formal assessment and approval. Equity loan headroom depends on the latest bank valuation and prevailing LTV limits.',
        autoPrint: d.autoPrint,
    })
}
