const SHEETS_URL = process.env.GOOGLE_APPS_SCRIPT_URL
const SHEETS_SECRET = process.env.APPS_SCRIPT_SECRET

export interface DriveDocPayload {
    signedUrl: string
    file_name: string
    file_type: string
    case_id: string
    client_name: string
}

export function syncDocumentToDrive(payload: DriveDocPayload): void {
    if (!SHEETS_URL || !SHEETS_SECRET) {
        console.warn('[drive-sync] GOOGLE_APPS_SCRIPT_URL or APPS_SCRIPT_SECRET not set — skipping')
        return
    }
    fetch(SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'document', ...payload, _secret: SHEETS_SECRET }),
    })
        .then(async (res) => {
            if (!res.ok) {
                const text = await res.text().catch(() => '')
                console.error(`[drive-sync] Apps Script returned ${res.status}: ${text}`)
            }
        })
        .catch((err) => console.error('[drive-sync] fetch failed:', err))
}
