import { createAdminClient } from '@/lib/supabase/admin'
import { sendFollowUpReminder } from '@/lib/email/sendFollowUpReminder'
import { sendToPrivyr } from '@/lib/privyr/sendToPrivyr'

export interface ProcessResult {
    processed: number
    caseStatusUpdated: number
    emailsSent: number
    privyrSent: number
    errors: string[]
}

// Statuses where a lock-in reminder should trigger an opportunity_due transition
const ELIGIBLE_STATUSES = ['submitted', 'paid']

export async function processReminders(): Promise<ProcessResult> {
    const admin = createAdminClient()
    const today = new Date().toISOString().split('T')[0]

    const { data: dueReminders, error: fetchError } = await admin
        .from('property_reminders')
        .select('id, case_id, reminder_type, trigger_date')
        .eq('is_sent', false)
        .lte('trigger_date', today)

    if (fetchError) {
        return { processed: 0, caseStatusUpdated: 0, emailsSent: 0, privyrSent: 0, errors: [fetchError.message] }
    }

    const result: ProcessResult = {
        processed: dueReminders?.length ?? 0,
        caseStatusUpdated: 0,
        emailsSent: 0,
        privyrSent: 0,
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

    // ── Self-follow-up reminders ──────────────────────────────────────────────
    // Query cases directly — no property_reminders row needed.
    // Fires on the agent-calculated follow_up_date (LOO + lock_in_years - 2 months).
    const { data: selfFollowUps, error: followUpError } = await admin
        .from('property_cases')
        .select(`
            id, client_name, client_mobile, client_email, agent_id,
            projected_agent_income, lock_in_period,
            outstanding_loan_amount, follow_up_date,
            banks(name)
        `)
        .eq('followup_preference', 'self')
        .eq('follow_up_date', today)
        .is('followup_completed_at', null)

    if (followUpError) {
        result.errors.push(`Follow-up query: ${followUpError.message}`)
    }

    for (const c of selfFollowUps ?? []) {
        try {
            const { data: { user: agentUser } } = await admin.auth.admin.getUserById(c.agent_id)
            if (!agentUser?.email) continue

            const { data: profile } = await admin
                .from('profiles')
                .select('full_name, name')
                .eq('id', c.agent_id)
                .single()

            const agentName = profile?.full_name ?? profile?.name ?? 'Agent'
            const bankName = (c.banks as { name?: string } | null)?.name ?? null

            await sendFollowUpReminder({
                agentEmail: agentUser.email,
                agentName,
                clientName: c.client_name,
                clientMobile: c.client_mobile,
                caseId: c.id,
                bankName,
                projectedAgentIncome: c.projected_agent_income,
                lockInPeriod: c.lock_in_period,
            })
            result.emailsSent++
            result.processed++

            // Send lead to Privyr so the automated WhatsApp template fires
            const privyrResult = await sendToPrivyr({
                name: c.client_name,
                phone: c.client_mobile,
                email: c.client_email,
                otherFields: {
                    'Source': 'TLC Property CRM',
                    'Bank': bankName ?? undefined,
                    'Lock-In Period (Years)': c.lock_in_period ?? undefined,
                    'Outstanding Loan (SGD)': c.outstanding_loan_amount ?? undefined,
                    'Follow-Up Date': c.follow_up_date ?? undefined,
                    'Case URL': `${process.env.NEXT_PUBLIC_APP_URL}/property/cases/${c.id}`,
                },
            })
            if (privyrResult.ok) {
                result.privyrSent++
            } else {
                result.errors.push(`Privyr (property case ${c.id}): ${privyrResult.error}`)
            }
        } catch (e) {
            result.errors.push(`Follow-up email for case ${c.id}: ${String(e)}`)
        }
    }

    return result
}
