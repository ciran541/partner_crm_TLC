import { createAdminClient } from '@/lib/supabase/admin'
import { sendOpportunityAlert } from '@/lib/email/sendOpportunityAlert'

export interface ProcessResult {
    processed: number
    caseStatusUpdated: number
    emailsSent: number
    errors: string[]
}

// Statuses where a lock-in reminder should trigger an opportunity_due transition
const ELIGIBLE_STATUSES = ['submitted', 'under_review', 'verified', 'on_hold', 'paid']

export async function processReminders(): Promise<ProcessResult> {
    const admin = createAdminClient()
    const today = new Date().toISOString().split('T')[0]

    const { data: dueReminders, error: fetchError } = await admin
        .from('property_reminders')
        .select('id, case_id, reminder_type, trigger_date')
        .eq('is_sent', false)
        .lte('trigger_date', today)

    if (fetchError) {
        return { processed: 0, caseStatusUpdated: 0, emailsSent: 0, errors: [fetchError.message] }
    }

    const result: ProcessResult = {
        processed: dueReminders?.length ?? 0,
        caseStatusUpdated: 0,
        emailsSent: 0,
        errors: [],
    }

    for (const reminder of dueReminders ?? []) {
        try {
            // Fetch case with agent profile and email
            const { data: caseRow } = await admin
                .from('property_cases')
                .select(`
                    id, status, client_name, lockin_confirmed_date,
                    projected_agent_income, agent_id,
                    profiles!inner(full_name, name)
                `)
                .eq('id', reminder.case_id)
                .single()

            if (!caseRow || !ELIGIBLE_STATUSES.includes(caseRow.status)) {
                await admin.from('property_reminders').update({ is_sent: true, sent_at: new Date().toISOString() }).eq('id', reminder.id)
                continue
            }

            // Transition case to opportunity_due
            const { error: updateError } = await admin
                .from('property_cases')
                .update({ status: 'opportunity_due' })
                .eq('id', reminder.case_id)

            if (updateError) {
                result.errors.push(`Case ${reminder.case_id}: ${updateError.message}`)
            } else {
                result.caseStatusUpdated++

                // Fetch agent email from auth.users via admin API
                const { data: { user: agentUser } } = await admin.auth.admin.getUserById(caseRow.agent_id)

                if (agentUser?.email) {
                    const profile = caseRow.profiles as unknown as { full_name?: string; name?: string }
                    const agentName = profile?.full_name || profile?.name || 'Agent'

                    try {
                        await sendOpportunityAlert({
                            agentEmail: agentUser.email,
                            agentName,
                            clientName: caseRow.client_name,
                            caseId: caseRow.id,
                            projectedAgentIncome: caseRow.projected_agent_income,
                            lockinConfirmedDate: caseRow.lockin_confirmed_date,
                        })
                        result.emailsSent++
                    } catch (emailErr) {
                        result.errors.push(`Email for case ${reminder.case_id}: ${String(emailErr)}`)
                    }
                }
            }

            // Mark reminder as sent regardless of email outcome
            await admin
                .from('property_reminders')
                .update({ is_sent: true, sent_at: new Date().toISOString() })
                .eq('id', reminder.id)
        } catch (e) {
            result.errors.push(`Reminder ${reminder.id}: ${String(e)}`)
        }
    }

    return result
}
