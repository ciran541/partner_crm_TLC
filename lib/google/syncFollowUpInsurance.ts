import { createAdminClient } from '@/lib/supabase/admin'
import { getCalendarClientForAgent } from './oauth'
import { createFollowUpEvent, updateFollowUpEvent, deleteFollowUpEvent } from './calendar'

/**
 * Syncs an insurance case follow-up date to the agent's personal Google Calendar.
 * Mirrors lib/google/syncFollowUp.ts but tracks events in insurance_calendar_events
 * (insurance always uses the agent's own calendar — there is no TLC routing here).
 *
 * Never throws — calendar errors must never block the follow-up save.
 */
export async function syncInsuranceFollowUp(
    agentId: string,
    caseId: string,
    action: 'upsert' | 'delete',
    followUpDate?: string | null,
    clientName?: string | null,
    caseUrl?: string,
    clientPhone?: string | null,
): Promise<void> {
    try {
        const admin = createAdminClient()

        const { data: profile } = await admin
            .from('profiles')
            .select('google_refresh_token')
            .eq('id', agentId)
            .single()

        // Agent hasn't connected Google Calendar — nothing to sync.
        if (!profile?.google_refresh_token) return

        const calendarClient = getCalendarClientForAgent(profile.google_refresh_token)
        const calendarId = 'primary'

        // Not .single() — that errors out on more than one row for this case_id,
        // and the error is silently swallowed below, causing every branch to
        // wrongly behave as "no event yet". Ordering + limit(1) tolerates any
        // pre-existing duplicates (see migration 20260807000000) instead of
        // breaking on them.
        const { data: existingEvents } = await admin
            .from('insurance_calendar_events')
            .select('id, google_event_id')
            .eq('case_id', caseId)
            .order('updated_at', { ascending: false })
            .limit(1)
        const existingEvent = existingEvents?.[0]

        if (action === 'delete') {
            if (existingEvent?.google_event_id) {
                await deleteFollowUpEvent(calendarClient, existingEvent.google_event_id, calendarId)
                await admin.from('insurance_calendar_events').delete().eq('case_id', caseId)
            }
            return
        }

        if (!followUpDate) return

        if (existingEvent?.google_event_id) {
            await updateFollowUpEvent(
                calendarClient,
                existingEvent.google_event_id,
                followUpDate,
                calendarId,
                clientName,
                clientPhone,
            )
            await admin
                .from('insurance_calendar_events')
                .upsert(
                    {
                        case_id: caseId,
                        agent_id: agentId,
                        google_event_id: existingEvent.google_event_id,
                        calendar_target: 'self',
                        event_date: followUpDate,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'case_id' },
                )
        } else {
            const googleEventId = await createFollowUpEvent(
                calendarClient,
                clientName ?? 'Client',
                followUpDate,
                caseUrl ?? '',
                calendarId,
                clientPhone,
            )
            // upsert, not insert — the case_id unique index (migration 20260807000000)
            // means a race with another concurrent sync now safely converges on one
            // row instead of erroring out or duplicating.
            await admin.from('insurance_calendar_events').upsert(
                {
                    case_id: caseId,
                    agent_id: agentId,
                    google_event_id: googleEventId,
                    calendar_target: 'self',
                    event_date: followUpDate,
                },
                { onConflict: 'case_id' },
            )
        }
    } catch (err) {
        console.error('[syncInsuranceFollowUp] error:', err)
        await handleInvalidGrant(agentId, err)
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
