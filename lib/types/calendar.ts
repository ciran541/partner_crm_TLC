/**
 * Layer 7 — Economic Calendar. Three event types, three different sourcing
 * paths (see lib/insurance/economicCalendar.ts) feeding one shared table.
 */

export const EVENT_KEYS = ['fomc_meeting', 'us_cpi', 'mas_mps'] as const
export type EventKey = (typeof EVENT_KEYS)[number]

export const EVENT_KEY_LABELS: Record<EventKey, string> = {
    fomc_meeting: 'FOMC Meeting',
    us_cpi: 'US CPI',
    mas_mps: 'MAS Monetary Policy Statement',
}

export interface EconomicCalendarEvent {
    id: string
    event_key: EventKey
    event_name: string
    event_date: string
    actual: number | null
    previous: number | null
    forecast: number | null
    unit: string | null
    impact_stars: number
    is_manual: boolean
    hidden: boolean
    admin_notes: string | null
    external_key: string
    fetched_at?: string
    created_at?: string
    updated_at?: string
}

// Input for admin QA create/edit (manual MAS MPS entries, or overrides).
export interface EconomicCalendarEventInput {
    event_key: EventKey
    event_name: string
    event_date: string
    actual?: number | null
    previous?: number | null
    forecast?: number | null
    unit?: string | null
    impact_stars?: number
    admin_notes?: string | null
    hidden?: boolean
}
