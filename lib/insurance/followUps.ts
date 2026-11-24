/**
 * Follow-up rules for HUB Premium — the ONE place they live in TypeScript.
 *
 * Agreed 2026-11-20 (see CLAUDE.md "Follow-ups & Action Centre"):
 *   - Every case always has a next follow-up date + remark. The only way out is
 *     Closed Lost with "Don't follow up" ticked. There is no "Mark done" — the
 *     agent always sets the next date.
 *   - The remark pre-fills from the case's stage; the agent may edit it.
 *   - Client reminders (WhatsApp + email) go ONLY for Closed Won cases whose
 *     agent ticked "Client agreed to receive reminders", once, on the date.
 *
 * The SQL side (auto remark + "date required" trigger) is migration
 * 20261124000000_follow_up_required.sql. AUTO_REMARKS is mirrored there —
 * change both together (followUps.test.ts pins the wording).
 *
 * Pure: no React, no network.
 */

import type { ClosedWonData, PipelineStage } from '@/lib/types'

/** Pre-filled remark per stage. Inactive has none yet (product decision: later). */
export const AUTO_REMARKS: Partial<Record<PipelineStage, string>> = {
    'Touched Base': 'Engage Prospect',
    'Pending Docs': 'Obtain Documents',
    'Pending Approval': 'Check Approval',
    'Pending Signature': 'Facilitate Signing',
    'Closed Won': 'Closed Won Previously. To Revisit',
    'Closed Lost': 'Closed Lost Previously. To Revisit',
}

export function autoRemark(stage: string | null | undefined): string {
    return AUTO_REMARKS[stage as PipelineStage] ?? ''
}

/** A planner draft: Touched Base with no client name yet (mirrors isDraftCase / search_cases). */
export function isDraft(c: { stage?: string | null; client_name?: string | null }): boolean {
    return c.stage === 'Touched Base' && !(c.client_name ?? '').trim()
}

/** Does this case still need a follow-up date set? */
export function needsFollowUp(c: {
    stage?: string | null
    client_name?: string | null
    follow_up_date?: string | null
    no_follow_up?: boolean | null
}): boolean {
    if (c.follow_up_date) return false
    if (c.no_follow_up && c.stage === 'Closed Lost') return false
    return !isDraft(c)
}

// ─── Dates (YYYY-MM-DD strings, SGT calendar days) ───────────────────────────

function parts(d: string): [number, number, number] {
    const [y, m, day] = d.slice(0, 10).split('-').map(Number)
    return [y, m, day]
}
function fmt(y: number, m: number, d: number): string {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Add whole months, clamping to month end (31 Aug − 6 mo → 28/29 Feb). */
export function addMonths(date: string, months: number): string {
    const [y, m, d] = parts(date)
    const total = (y * 12 + (m - 1)) + months
    const ny = Math.floor(total / 12)
    const nm = (total % 12) + 1
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
    return fmt(ny, nm, Math.min(d, last))
}

export function addDays(date: string, days: number): string {
    const [y, m, d] = parts(date)
    const t = new Date(Date.UTC(y, m - 1, d + days))
    return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
    const [fy, fm, fd] = parts(from)
    const [ty, tm, td] = parts(to)
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** How long before a lock-in ends to follow up — time to compare packages and reprice. */
export const LOCKIN_LEAD_MONTHS = 3
/** Fallback when the lock-in end is unknown. */
export const CLOSED_WON_FALLBACK_YEARS = 2

// ─── Lock-in limit (agreed 2026-11-24) ───────────────────────────────────────
//
// A Closed Won or Inactive client's follow-up can't be later than 2 months before
// their lock-in ends: after that they've usually been approached elsewhere. The
// limit lifts on the day it arrives, so an agent told "call me in two weeks"
// isn't left with no date they can save. Open stages aren't limited.
// SQL twins: case_lock_in_end() and cases_follow_up_lockin_limit().

export const LOCKIN_LIMIT_MONTHS = 2

/** Lock-in end assumed from the closing date, when nobody entered the real one. */
export function estimateLockInEnd(closedAt: string | null | undefined, lockinYears: number | null | undefined): string | null {
    return closedAt && lockinYears && lockinYears > 0 ? addMonths(closedAt, lockinYears * 12) : null
}

type LockInCase = { stage?: string | null; lock_in_end_date?: string | null; closed_won_data?: ClosedWonData | null }

/** When the client's CURRENT loan leaves lock-in. Closed Won = the loan just closed, not the one it replaced. */
export function caseLockInEnd(c: LockInCase): string | null {
    if (c.stage !== 'Closed Won') return c.lock_in_end_date?.slice(0, 10) || null
    const cw = c.closed_won_data ?? {}
    return cw.lock_in_end_date?.slice(0, 10) || estimateLockInEnd(cw.closed_at, cw.package?.lockin_years)
}

/** Latest follow-up allowed for this lock-in end; null = no limit (none known, or already reached). */
export function lockInLimit(lockInEnd: string | null | undefined, today: string): string | null {
    if (!lockInEnd) return null
    const limit = addMonths(lockInEnd, -LOCKIN_LIMIT_MONTHS)
    return limit > today ? limit : null
}

/** The limit for a case once it is in `stage` (defaults to its current stage). */
export function followUpLimit(c: LockInCase, today: string, stage: string | null | undefined = c.stage): string | null {
    if (stage !== 'Closed Won' && stage !== 'Inactive') return null
    return lockInLimit(caseLockInEnd({ ...c, stage }), today)
}

/**
 * Default follow-up for a just-closed (won) case: LOCKIN_LEAD_MONTHS before the
 * new lock-in ends, else CLOSED_WON_FALLBACK_YEARS out. Never earlier than
 * tomorrow — a past default would land straight in "Overdue".
 */
export function defaultClosedWonFollowUp(closedAt: string, lockInEnd: string | null | undefined, today: string): string {
    const candidate = lockInEnd
        ? addMonths(lockInEnd, -LOCKIN_LEAD_MONTHS)
        : addMonths(closedAt, CLOSED_WON_FALLBACK_YEARS * 12)
    const tomorrow = addDays(today, 1)
    return candidate < tomorrow ? tomorrow : candidate
}

/**
 * Default follow-up for a case created without one (New Case, mass import):
 * LOCKIN_LEAD_MONTHS before a known future lock-in end, otherwise today — so
 * the agent sees it in "Today" and decides.
 */
export function defaultNewCaseFollowUp(lockInEnd: string | null | undefined, today: string): string {
    if (lockInEnd) {
        const lead = addMonths(lockInEnd, -LOCKIN_LEAD_MONTHS)
        if (lead > today) return lead
    }
    return today
}

// ─── Action Centre buckets ───────────────────────────────────────────────────

/** "Needs action" window: today plus this many days. Day 15 onward is "Later". */
export const SOON_DAYS = 14

export type FollowUpBucket = 'overdue' | 'today' | 'soon' | 'later'

export function followUpBucket(date: string, today: string): FollowUpBucket {
    const d = date.slice(0, 10)
    if (d < today) return 'overdue'
    if (d === today) return 'today'
    if (d <= addDays(today, SOON_DAYS)) return 'soon'
    return 'later'
}

// ─── Client reminders ────────────────────────────────────────────────────────

/** How many days late the daily job will still send (covers a missed cron run). */
export const REMINDER_CATCH_UP_DAYS = 3

/**
 * Should the daily job send this client their reminder today? Two layers
 * (boss's rule): Closed Won AND the agent ticked the consent box. Plus: the date
 * has arrived (within the catch-up window), it hasn't already been sent for this
 * date, and there's some way to reach the client.
 */
export function reminderDue(c: {
    stage?: string | null
    client_reminder_opt_in?: boolean | null
    follow_up_date?: string | null
    client_reminder_sent_for?: string | null
    client_email?: string | null
    client_mobile?: string | null
}, today: string): boolean {
    if (c.stage !== 'Closed Won' || !c.client_reminder_opt_in || !c.follow_up_date) return false
    const d = c.follow_up_date.slice(0, 10)
    if (d > today || daysBetween(d, today) > REMINDER_CATCH_UP_DAYS) return false
    if (c.client_reminder_sent_for?.slice(0, 10) === d) return false
    return !!(c.client_email?.trim() || c.client_mobile?.trim())
}
