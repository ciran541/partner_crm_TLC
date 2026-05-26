const SHEETS_URL = process.env.GOOGLE_APPS_SCRIPT_URL
const SHEETS_SECRET = process.env.APPS_SCRIPT_SECRET

export interface SheetsCasePayload {
    id: string
    agent_id: string
    agent_name: string | null
    case_type: string
    status: string
    client_name: string
    client_mobile: string
    client_email: string | null
    property_address: string
    bank_name: string | null
    interest_rate: number | null
    balance_tenure_months: number | null
    outstanding_loan_amount: number | null
    subsidy_amount: number | null
    lockin_estimated_date: string | null
    lockin_confirmed_date: string | null
    gross_commission_amount: number | null
    agent_commission_amount: number | null
    tlc_commission_amount: number | null
    commission_status: string
    projected_remaining_balance: number | null
    projected_gross_commission: number | null
    projected_agent_income: number | null
    projected_tlc_income: number | null
    actual_recurring_gross: number | null
    actual_recurring_agent_income: number | null
    actual_recurring_tlc_income: number | null
    recurring_converted: boolean
    is_duplicate: boolean
    duplicate_reason: string | null
    notes: string | null
    created_at: string
    updated_at: string
}

export interface SheetsProfilePayload {
    id: string
    email: string | null
    full_name: string | null
    name: string | null
    role: string
    mobile: string | null
    cea_registration_no: string | null
    agency_name: string | null
    app_type: string
    status: string
    joined_at: string | null
    created_at: string | null
}

export function syncProfileToSheets(payload: SheetsProfilePayload): void {
    if (!SHEETS_URL || !SHEETS_SECRET) {
        console.warn('[sheets-sync] GOOGLE_APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not set — skipping')
        return
    }
    fetch(SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'profile', ...payload, _secret: SHEETS_SECRET }),
    })
        .then(async (res) => {
            if (!res.ok) {
                const text = await res.text().catch(() => '')
                console.error(`[sheets-sync] Apps Script returned ${res.status}: ${text}`)
            }
        })
        .catch((err) => console.error('[sheets-sync] profile fetch failed:', err))
}

export function syncCaseToSheets(payload: SheetsCasePayload): void {
    if (!SHEETS_URL || !SHEETS_SECRET) {
        console.warn('[sheets-sync] GOOGLE_APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not set — skipping')
        return
    }
    fetch(SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'case', ...payload, _secret: SHEETS_SECRET }),
    })
        .then(async (res) => {
            if (!res.ok) {
                const text = await res.text().catch(() => '')
                console.error(`[sheets-sync] Apps Script returned ${res.status}: ${text}`)
            }
        })
        .catch((err) => console.error('[sheets-sync] fetch failed:', err))
}
