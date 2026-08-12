import type { calendar_v3 } from 'googleapis'

// Green colour for follow-up events in Google Calendar
const EVENT_COLOR_ID = '2' // Sage (green)

/**
 * Builds the event title: "Follow-up: Jane Tan 91234567".
 *
 * The mobile is in the title rather than only the description because that is
 * the one line Google shows in a month grid, a notification and a phone's lock
 * screen — an agent seeing the reminder can dial straight from it without
 * opening the event or the CRM.
 *
 * Degrades to the bare name when no mobile is on the case: insurance's
 * client_mobile is nullable (property's is NOT NULL), so this must not render
 * a dangling separator or the string "null".
 */
export function followUpTitle(clientName: string, clientPhone?: string | null): string {
    const phone = clientPhone?.trim()
    return phone ? `Follow-up: ${clientName} ${phone}` : `Follow-up: ${clientName}`
}

/**
 * Creates an all-day follow-up calendar event.
 * @returns The Google Calendar event ID (needed for future updates/deletes)
 */
export async function createFollowUpEvent(
    calendarClient: calendar_v3.Calendar,
    clientName: string,
    followUpDate: string, // 'YYYY-MM-DD'
    caseUrl: string,
    calendarId = 'primary',
    clientPhone?: string | null
): Promise<string> {
    const response = await calendarClient.events.insert({
        calendarId,
        requestBody: {
            summary: followUpTitle(clientName, clientPhone),
            description: `View case in TLC Property CRM:\n${caseUrl}`,
            colorId: EVENT_COLOR_ID,
            start: { date: followUpDate },
            end: { date: followUpDate },
            // Remind on the day at 8 AM
            reminders: {
                useDefault: false,
                overrides: [
                    { method: 'email', minutes: 0 },
                    { method: 'popup', minutes: 0 },
                ],
            },
        },
    })

    const eventId = response.data.id
    if (!eventId) throw new Error('Google Calendar did not return an event ID')
    return eventId
}

/**
 * Updates the date of an existing follow-up calendar event, and re-titles it
 * when a client name is supplied.
 *
 * The retitle keeps already-synced events correct: without it, every event
 * created before the mobile was added to the title would keep its name-only
 * title forever, and a corrected mobile in the CRM would never reach the
 * calendar. patch() leaves omitted fields untouched, so passing no name keeps
 * this a date-only update exactly as before.
 */
export async function updateFollowUpEvent(
    calendarClient: calendar_v3.Calendar,
    eventId: string,
    followUpDate: string, // 'YYYY-MM-DD'
    calendarId = 'primary',
    clientName?: string | null,
    clientPhone?: string | null
): Promise<void> {
    await calendarClient.events.patch({
        calendarId,
        eventId,
        requestBody: {
            start: { date: followUpDate },
            end: { date: followUpDate },
            ...(clientName ? { summary: followUpTitle(clientName, clientPhone) } : {}),
        },
    })
}

/**
 * Deletes a follow-up calendar event.
 * Silently ignores 404 (event already deleted).
 */
export async function deleteFollowUpEvent(
    calendarClient: calendar_v3.Calendar,
    eventId: string,
    calendarId = 'primary'
): Promise<void> {
    try {
        await calendarClient.events.delete({ calendarId, eventId })
    } catch (err: unknown) {
        // If the event was already deleted or never existed, that's fine
        const status = (err as { code?: number })?.code
        if (status === 404 || status === 410) return
        throw err
    }
}
