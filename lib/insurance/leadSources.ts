/**
 * Lead sources — where a case came from (agreed 2026-11-21). The ONE list:
 * New Case, mass upload, the case page and the Dashboard all read it. The
 * codes are enforced by the DB (cases_lead_source_valid, migration
 * 20261201000000) — add a source in both places.
 *
 * Pure: no React, no network.
 */

export type LeadSource =
    | 'existing_client' | 'referral' | 'professional_referral' | 'social_media'
    | 'website_search' | 'networking_events' | 'others'

export interface LeadSourceInfo {
    value: LeadSource
    label: string
    /** What it covers — shown as help text in the picker. */
    includes: string
}

export const LEAD_SOURCES: LeadSourceInfo[] = [
    { value: 'existing_client', label: 'Existing Client', includes: 'Existing insurance or mortgage clients' },
    { value: 'referral', label: 'Referral', includes: 'Client referrals, friends, family' },
    { value: 'professional_referral', label: 'Professional Referral', includes: 'Property agents, insurance agents, bankers' },
    { value: 'social_media', label: 'Social Media', includes: 'Facebook, Instagram, TikTok' },
    { value: 'website_search', label: 'Website / Search', includes: 'Website, Google, Bing' },
    { value: 'networking_events', label: 'Networking / Events', includes: 'Roadshows, seminars, networking' },
    { value: 'others', label: 'Others', includes: 'Any other source' },
]

/** Older cases and uploads without a source. Shown, never hidden, in analytics. */
export const NOT_SET = 'not_set'
export const NOT_SET_LABEL = 'Not set'

export function leadSourceLabel(v: string | null | undefined): string {
    return LEAD_SOURCES.find(s => s.value === v)?.label ?? NOT_SET_LABEL
}

export function isLeadSource(v: unknown): v is LeadSource {
    return typeof v === 'string' && LEAD_SOURCES.some(s => s.value === v)
}

/**
 * Match what an agent typed in a spreadsheet: the label, the code, or a word
 * it obviously covers ("Facebook" → Social Media, "property agent" →
 * Professional Referral). Blank → undefined; unrecognisable → null.
 */
export function matchLeadSource(raw: unknown): LeadSource | undefined | null {
    const t = String(raw ?? '').trim().toLowerCase()
    if (!t) return undefined
    const flat = t.replace(/[^a-z]/g, '')
    for (const s of LEAD_SOURCES) {
        if (flat === s.value.replace(/_/g, '') || flat === s.label.toLowerCase().replace(/[^a-z]/g, '')) return s.value
    }
    // Match at the START of a word, so short tokens can't hide inside longer
    // words ("ig" in "campaign", "web" in "cobweb"); prefixes still work
    // ("referr" → "referral", "network" → "networking").
    // (The keywords below are plain words — nothing to escape.)
    const has = (...words: string[]) => words.some(w => new RegExp(`(^|[^a-z])${w}`).test(t))
    if (has('existing', 'past client', 'old client', 'current client', 'repeat')) return 'existing_client'
    if (has('agent', 'banker', 'professional', 'broker')) return 'professional_referral'
    if (has('referr', 'friend', 'family', 'word of mouth')) return 'referral'
    if (has('facebook', 'instagram', 'tiktok', 'social', 'fb', 'ig', 'linkedin')) return 'social_media'
    if (has('website', 'google', 'bing', 'search', 'web', 'seo')) return 'website_search'
    if (has('event', 'roadshow', 'seminar', 'network')) return 'networking_events'
    if (has('other')) return 'others'
    return null
}
