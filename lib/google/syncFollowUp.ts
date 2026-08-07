import { createAdminClient } from '@/lib/supabase/admin'
import { getCalendarClientForAgent, getCalendarClientForTLC } from './oauth'
import { createFollowUpEvent, updateFollowUpEvent, deleteFollowUpEvent } from './calendar'

/**
 * Syncs a follow-up date to the appropriate Google Calendar based on followup_preference.
 *
 * Routing:
 *  - 'self'  → agent's personal Google Calendar (uses their stored refresh_token)
 *  - 'tlc'   → TLC's shared Google Calendar (uses TLC_GOOGLE_REFRESH_TOKEN env var)
 *  - null    → skip silently
 *
 * Action:
 *  - 'upsert' → create event if none exists, update date if one already exists
 *  - 'delete' → delete the event and remove the DB tracking row
 *
 * All errors are caught and logged — this function NEVER throws.
 */
export async function syncFollowUpToCalendar(
    agentId: string,
    caseId: string,
    followupPreference: 'self' | 'tlc' | null,
    action: 'upsert' | 'delete',
    followUpDate?: string | null,
    clientName?: string | null,
    caseUrl?: string
): Promise<void> {
    try {
        // Nothing to do if no preference
        if (!followupPreference) return

        const admin = createAdminClient()

        // Determine which calendar client and target calendar ID to use
        let calendarClient
        let calendarId: string

        if (followupPreference === 'self') {
            // Fetch agent's stored refresh token
            const { data: profile } = await admin
                .from('profiles')
                .select('google_refresh_token')
                .eq('id', agentId)
                .single()

            if (!profile?.google_refresh_token) {
                // Agent hasn't connected Google Calendar yet — skip silently
                return
            }

            calendarClient = getCalendarClientForAgent(profile.google_refresh_token)
            calendarId = 'primary' // always the agent's own primary calendar
        } else {
            // 'tlc' — use TLC shared account + configured calendar ID
            calendarClient = getCalendarClientForTLC()
            calendarId = process.env.TLC_GOOGLE_CALENDAR_ID ?? 'primary'
        }

        // Look up any existing calendar event row for this case. Not .single() —
        // it errors on more than one row and that error is silently swallowed
        // below, which would make every branch wrongly act as "no event yet".
        // order + limit(1) is defensive here even though case_id is already
        // unique-indexed (see the matching insurance fix, migration 20260807000000,
        // for what happens without it).
        const { data: existingEvents } = await admin
            .from('property_calendar_events')
            .select('id, google_event_id')
            .eq('case_id', caseId)
            .order('updated_at', { ascending: false })
            .limit(1)
        const existingEvent = existingEvents?.[0]

        if (action === 'delete') {
            if (existingEvent?.google_event_id) {
                await deleteFollowUpEvent(calendarClient, existingEvent.google_event_id, calendarId)
                await admin
                    .from('property_calendar_events')
                    .delete()
                    .eq('case_id', caseId)
            }
            return
        }

        // action === 'upsert'
        if (!followUpDate) return // can't create without a date

        if (existingEvent?.google_event_id) {
            // Update existing event
            await updateFollowUpEvent(calendarClient, existingEvent.google_event_id, followUpDate, calendarId)
            await admin
                .from('property_calendar_events')
                .upsert(
                    {
                        case_id: caseId,
                        agent_id: agentId,
                        google_event_id: existingEvent.google_event_id,
                        calendar_target: followupPreference,
                        event_date: followUpDate,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'case_id' },
                )
        } else {
            // Create new event
            const googleEventId = await createFollowUpEvent(
                calendarClient,
                clientName ?? 'Client',
                followUpDate,
                caseUrl ?? '',
                calendarId
            )

            // upsert, not insert — a concurrent duplicate save now converges on
            // one row via the case_id unique index instead of throwing a unique-
            // violation error that silently drops the sync.
            await admin.from('property_calendar_events').upsert(
                {
                    case_id: caseId,
                    agent_id: agentId,
                    google_event_id: googleEventId,
                    calendar_target: followupPreference,
                    event_date: followUpDate,
                },
                { onConflict: 'case_id' },
            )
        }
    } catch (err) {
        // Non-blocking — log but never let calendar errors surface to the user
        console.error('[syncFollowUpToCalendar] error:', err)
        // Only the 'self' path uses a per-agent refresh token — 'tlc' uses the
        // shared service account, whose credentials aren't agent-specific and
        // shouldn't be cleared based on one agent's sync failure.
        if (followupPreference === 'self') {
            await handleInvalidGrant(agentId, err)
        }
    }
}

// Google returns invalid_grant when a refresh token has been revoked or expired
// (e.g. the agent removed the app's access from their Google Account) — that
// token is now permanently dead. Without this, Profile keeps claiming
// "Connected" forever and every future sync fails the same way with no visible
// error to the agent. Clearing it here flips Profile to "Disconnected" so the
// agent is naturally prompted to reconnect.
async function handleInvalidGrant(agentId: string, err: unknown): Promise<void> {
    const isInvalidGrant =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error === 'invalid_grant' ||
        (err instanceof Error && err.message === 'invalid_grant')
    if (!isInvalidGrant) return

    await createAdminClient()
        .from('profiles')
        .update({ google_refresh_token: null, google_calendar_connected: false })
        .eq('id', agentId)
}
