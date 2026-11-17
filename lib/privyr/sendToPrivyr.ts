/**
 * Privyr generic-webhook integration.
 *
 * POST a refinancing-due lead to the Privyr account webhook so Privyr can
 * trigger the automated WhatsApp message template for that lead.
 *
 * Docs: https://www.privyr.com/api/v1/incoming-leads/{string_1}/{string_2}
 * Payload shape: { name, phone, email?, display_name?, other_fields? }
 *
 * We always include `"notes": "refinancing_due"` in other_fields so Privyr
 * can route the lead to the correct WhatsApp template.
 */

const PRIVYR_WEBHOOK_URL = process.env.PRIVYR_WEBHOOK_URL
    ?? 'https://www.privyr.com/api/v1/incoming-leads/0vZfjMQw/jqnkVwwV'

export interface PrivyrLeadParams {
    /** Full name of the client / lead */
    name: string
    /** Client phone number — ideally in E.164 format e.g. "+6591234567" */
    phone: string
    /** Optional client email */
    email?: string | null
    /** Other metadata sent as key-value pairs in other_fields */
    otherFields?: Record<string, string | number | null | undefined>
}

export interface PrivyrLeadResult {
    ok: boolean
    leadId?: string
    error?: string
}

/**
 * Sends one lead to Privyr. Never throws — errors are returned in the result
 * so the calling cron job can log them without aborting the whole batch.
 */
export async function sendToPrivyr(params: PrivyrLeadParams): Promise<PrivyrLeadResult> {
    const { name, phone, email, otherFields } = params

    // Merge caller-supplied other_fields with the mandatory identifier tag
    const other_fields: Record<string, string | number | null | undefined> = {
        ...otherFields,
        notes: 'refinancing_due',   // used by Privyr to route the correct WA template
    }

    const body = {
        name,
        phone,
        ...(email ? { email } : {}),
        other_fields,
    }

    try {
        const res = await fetch(PRIVYR_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })


        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText)
            return { ok: false, error: `HTTP ${res.status}: ${text}` }
        }

        const json = await res.json().catch(() => ({}))
        return { ok: true, leadId: json.lead_id }
    } catch (err) {
        return { ok: false, error: String(err) }
    }
}
