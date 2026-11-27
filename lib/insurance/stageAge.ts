/** Days a case has sat in its stage, and when that counts as stuck (Track board). */

/** Prospects move slower than paperwork. */
const STUCK_DAYS: Record<string, number> = {
    'Touched Base': 30,
    'Pending Docs': 14,
    'IPA': 14,
    'Pending Approval': 14,
    'Pending Signature': 14,
}

export function daysInStage(changedAt: string | null | undefined, now: number = Date.now()): number | null {
    if (!changedAt) return null
    const t = Date.parse(changedAt)
    return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / 86_400_000))
}

export function isStuck(stage: string, days: number | null): boolean {
    return days != null && days >= (STUCK_DAYS[stage] ?? Infinity)
}
