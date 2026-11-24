/** One row of agent_follow_up_health(). */
export interface HealthRow {
    agent: string; name: string; status: string
    overdue: number; today: number; soon: number; missing: number; open_cases: number
    /** Oldest overdue follow-up date. */
    oldest: string | null
}
