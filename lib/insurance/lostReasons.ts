/**
 * Closed Lost reasons: the five agents pick from, and how the older, more
 * detailed reasons group into them. Old cases keep their stored wording; only
 * the Dashboard groups them.
 */
export const LOST_REASONS = ['Not Proceeding', 'Not Eligible', 'Competition', 'Unresponsive', 'Others'] as const
export type LostReasonGroup = (typeof LOST_REASONS)[number]

const LEGACY: Record<string, LostReasonGroup> = {
    'Client decided not to refinance': 'Not Proceeding',
    'Client selling property': 'Not Proceeding',
    'Loan not approved': 'Not Eligible',
    'Client chose another bank directly': 'Competition',
    'Client used another broker': 'Competition',
    'Rate not competitive enough': 'Competition',
    'Client unresponsive / lost contact': 'Unresponsive',
}

/** 'Other', a missing reason and anything unrecognised are Others. */
export function lostReasonGroup(stored: string): LostReasonGroup {
    const s = stored.trim()
    return LOST_REASONS.find(r => r === s) ?? LEGACY[s] ?? 'Others'
}
