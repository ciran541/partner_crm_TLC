/**
 * Insurance app — daily client reminders (GET /api/cron/insurance-followups).
 *
 * The client is contacted ONLY when both layers are true (business rule,
 * agreed 2026-11-20):
 *   1. the case is Closed Won, and
 *   2. the agent ticked "Client agreed to receive a reminder".
 * Then, on the follow-up date (the future-business / lock-in-nearing date),
 * the client gets ONE WhatsApp (Privyr template) and ONE email. Status changes
 * and follow-up dates at every other stage are for the agent only — they never
 * message the client. reminderDue() in followUps.ts is the gate.
 *
 * Once sent, client_reminder_sent_for = that follow_up_date, so a re-run can't
 * message the client twice; moving the date re-arms it. A missed cron run is
 * caught up for REMINDER_CATCH_UP_DAYS.
 *
 * Agents get no email from Premium — the Action Centre and Google Calendar
 * sync are their reminders.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sendToPrivyr } from '@/lib/privyr/sendToPrivyr'
import { sendClientLoanReminder } from '@/lib/email/sendClientLoanReminder'
import { todaySgt } from '@/lib/insurance/promotions'
import { addDays, caseLockInEnd, reminderDue, REMINDER_CATCH_UP_DAYS } from '@/lib/insurance/followUps'
import type { ClosedWonData } from '@/lib/types'

export interface InsuranceFollowUpResult {
    processed: number
    privyrSent: number
    emailsSent: number
    errors: string[]
}

interface Agent { name: string; mobile: string | null; email: string | null }

export async function processInsuranceFollowUps(): Promise<InsuranceFollowUpResult> {
    const admin = createAdminClient()
    const today = todaySgt()
    const result: InsuranceFollowUpResult = { processed: 0, privyrSent: 0, emailsSent: 0, errors: [] }

    const { data: cases, error } = await admin
        .from('cases')
        .select(`
            id, created_by, client_name, client_mobile, client_email,
            case_type, current_bank, existing_loan_amount, lock_in_end_date,
            follow_up_date, stage, client_reminder_opt_in, client_reminder_sent_for,
            closed_won_data
        `)
        .eq('stage', 'Closed Won')
        .eq('client_reminder_opt_in', true)
        .gte('follow_up_date', addDays(today, -REMINDER_CATCH_UP_DAYS))
        .lte('follow_up_date', today)

    if (error) {
        result.errors.push(`Insurance reminder query: ${error.message}`)
        return result
    }

    const agents = new Map<string, Agent>()
    const agentFor = async (id: string): Promise<Agent> => {
        const hit = agents.get(id)
        if (hit) return hit
        const [{ data: profile }, { data: auth }] = await Promise.all([
            admin.from('profiles').select('name, full_name, mobile').eq('id', id).single(),
            admin.auth.admin.getUserById(id),
        ])
        const agent = {
            name: profile?.full_name || profile?.name || 'Your loan specialist',
            mobile: profile?.mobile ?? null,
            email: auth?.user?.email ?? null,
        }
        agents.set(id, agent)
        return agent
    }

    for (const c of cases ?? []) {
        if (!reminderDue(c, today)) continue
        result.processed++

        const cw = (c.closed_won_data ?? {}) as ClosedWonData
        const lockInEnd = caseLockInEnd(c)
        const bank = cw.bank ?? c.current_bank ?? null
        let delivered = false

        if (c.client_mobile?.trim()) {
            try {
                const r = await sendToPrivyr({
                    name: c.client_name ?? 'Unknown',
                    phone: c.client_mobile,
                    email: c.client_email,
                    otherFields: {
                        'Source': 'TLC Insurance CRM',
                        'Case Type': c.case_type ?? undefined,
                        'Current Bank': bank ?? undefined,
                        'Existing Loan (SGD)': c.existing_loan_amount ?? undefined,
                        'Lock-In End Date': lockInEnd ?? undefined,
                        'Follow-Up Date': c.follow_up_date ?? undefined,
                        'Pipeline Stage': c.stage ?? undefined,
                        'Case URL': `${process.env.NEXT_PUBLIC_APP_URL}/insurance/dashboard/cases/${c.id}`,
                    },
                })
                if (r.ok) { result.privyrSent++; delivered = true }
                else result.errors.push(`Privyr (case ${c.id}): ${r.error}`)
            } catch (err) {
                result.errors.push(`Privyr (case ${c.id}): ${String(err)}`)
            }
        }

        if (c.client_email?.trim()) {
            try {
                const agent = await agentFor(c.created_by)
                await sendClientLoanReminder({
                    to: c.client_email.trim(),
                    clientName: c.client_name ?? '',
                    agentName: agent.name,
                    agentMobile: agent.mobile,
                    agentEmail: agent.email,
                    bank,
                    lockInEnd,
                })
                result.emailsSent++
                delivered = true
            } catch (err) {
                result.errors.push(`Email (case ${c.id}): ${err instanceof Error ? err.message : String(err)}`)
            }
        }

        // Marked once anything reached the client, so a partial failure doesn't
        // resend the channel that worked. If nothing got through, tomorrow retries.
        if (delivered) {
            const { error: markErr } = await admin
                .from('cases')
                .update({ client_reminder_sent_for: c.follow_up_date })
                .eq('id', c.id)
            if (markErr) result.errors.push(`Mark sent (case ${c.id}): ${markErr.message}`)
        }
    }

    return result
}
