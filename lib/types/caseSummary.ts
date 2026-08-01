/**
 * Shape of the `case_summary()` SQL function's return value
 * (supabase/migrations/20260801030000_case_summary_function.sql).
 *
 * Every figure here is computed over EVERY case matching the caller's scope —
 * not a downloaded page — so these are correct at any table size.
 *
 * Keys are snake_case because they come straight from the SQL function's
 * jsonb_build_object; they are deliberately not remapped, so a field can be
 * traced from screen to migration by grepping one name.
 */

export interface CaseSummaryCommission {
    /** Σ gross commission across cases with a bucket (excludes drafts + Closed Lost). */
    gross: number
    /** Σ agent share, same population as `gross`. */
    agent: number
    /** Σ TLC share, same population as `gross`. */
    tlc: number
    /** Agent share of the active pipeline. */
    open: number
    /** Agent share of Closed Won, not yet paid out. */
    closed_unpaid: number
    /** Agent share of Closed Won, paid out. */
    closed_paid: number
    /** open + closed_unpaid + closed_paid. */
    total: number
    /** Count of cases in the 'open' bucket. */
    active_cases: number
    count_open: number
    count_closed_unpaid: number
    count_closed_paid: number
}

export interface CaseSummary {
    /** Non-draft cases in scope. */
    total_cases: number
    /** Not Closed Won and not Closed Lost. */
    active_cases: number
    closed_won: number
    closed_lost: number
    /** Lock-ins expiring from today through the next 90 days, excluding Closed Lost. */
    upcoming_lock_ins: number
    /** Σ loan value across ALL non-draft cases, INCLUDING Closed Lost. */
    volume: number
    commission: CaseSummaryCommission
    /** Case count per stage. Stages with no cases are absent, not zero. */
    stage_counts: Record<string, number>
    /** Case count per case type. Types with no cases are absent, not zero. */
    type_counts: Record<string, number>
    /** Last six calendar months including the current one; empty months appear as 0. */
    monthly: { month: string; count: number }[]
    follow_ups: { total: number; overdue: number; upcoming: number }
    /** Top 10 agents by case count. Admin scope only in practice. */
    top_agents: { name: string; count: number; commission: number }[]
}

/** Zero-valued summary — lets a screen render its shell before data arrives. */
export const EMPTY_CASE_SUMMARY: CaseSummary = {
    total_cases: 0,
    active_cases: 0,
    closed_won: 0,
    closed_lost: 0,
    upcoming_lock_ins: 0,
    volume: 0,
    commission: {
        gross: 0, agent: 0, tlc: 0,
        open: 0, closed_unpaid: 0, closed_paid: 0,
        total: 0, active_cases: 0,
        count_open: 0, count_closed_unpaid: 0, count_closed_paid: 0,
    },
    stage_counts: {},
    type_counts: {},
    monthly: [],
    follow_ups: { total: 0, overdue: 0, upcoming: 0 },
    top_agents: [],
}
