import type { calendar_v3 } from 'googleapis'

// Green colour for follow-up events in Google Calendar
const EVENT_COLOR_ID = '2' // Sage (green)

/**
 * Creates an all-day follow-up calendar event.
 * @returns The Google Calendar event ID (needed for future updates/deletes)
 */
export async function createFollowUpEvent(
    calendarClient: calendar_v3.Calendar,
    clientName: string,
    followUpDate: string, // 'YYYY-MM-DD'
    caseUrl: string,
    calendarId = 'primary'
): Promise<string> {
    const response = await calendarClient.events.insert({
        calendarId,
        requestBody: {
            summary: `Follow-up: ${clientName}`,
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
 * Updates the date of an existing follow-up calendar event.
 */
export async function updateFollowUpEvent(
    calendarClient: calendar_v3.Calendar,
    eventId: string,
    followUpDate: string, // 'YYYY-MM-DD'
    calendarId = 'primary'
): Promise<void> {
    await calendarClient.events.patch({
        calendarId,
        eventId,
        requestBody: {
            start: { date: followUpDate },
            end: { date: followUpDate },
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
