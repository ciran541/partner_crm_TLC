/**
 * Insurance app — daily follow-up → Privyr pipeline.
 *
 * The insurance `cases` table has no automated cron today; agents set
 * `follow_up_date` manually. This module is called by the new
 * GET /api/cron/insurance-followups route (scheduled daily in vercel.json).
 *
 * For every insurance case where follow_up_date = today, we:
 *   1. POST the client lead to Privyr (notes: "refinancing_due") so the
 *      automated WhatsApp template fires.
 *
 * Unlike the property app there is no email sent here — the agent already
 * sees overdue/upcoming cases on /insurance/dashboard/followup. If you want
 * an email in future, add sendFollowUpReminder() here too.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { sendToPrivyr } from '@/lib/privyr/sendToPrivyr'

export interface InsuranceFollowUpResult {
    processed: number
    privyrSent: number
    errors: string[]
}

export async function processInsuranceFollowUps(): Promise<InsuranceFollowUpResult> {
    const admin = createAdminClient()
    const today = new Date().toISOString().split('T')[0]

    const result: InsuranceFollowUpResult = {
        processed: 0,
        privyrSent: 0,
        errors: [],
    }

    // Fetch all active insurance cases whose follow_up_date is today.
    // Exclude Closed Lost — there is nothing to follow up on those.
    const { data: cases, error } = await admin
        .from('cases')
        .select(`
            id, client_name, client_mobile, client_email,
            case_type, current_bank, existing_loan_amount,
            lock_in_end_date, follow_up_date, stage
        `)
        .eq('follow_up_date', today)
        .neq('stage', 'Closed Lost')

    if (error) {
        result.errors.push(`Insurance follow-up query: ${error.message}`)
        return result
    }

    for (const c of cases ?? []) {
        result.processed++
        try {
            const privyrResult = await sendToPrivyr({
                name: c.client_name ?? 'Unknown',
                phone: c.client_mobile ?? '',
                email: c.client_email,
                otherFields: {
                    'Source': 'TLC Insurance CRM',
                    'Case Type': c.case_type ?? undefined,
                    'Current Bank': c.current_bank ?? undefined,
                    'Existing Loan (SGD)': c.existing_loan_amount ?? undefined,
                    'Lock-In End Date': c.lock_in_end_date ?? undefined,
                    'Follow-Up Date': c.follow_up_date ?? undefined,
                    'Pipeline Stage': c.stage ?? undefined,
                    'Case URL': `${process.env.NEXT_PUBLIC_APP_URL}/insurance/dashboard/cases/${c.id}`,
                },
            })

            if (privyrResult.ok) {
                result.privyrSent++
            } else {
                result.errors.push(`Privyr (insurance case ${c.id}): ${privyrResult.error}`)
            }
        } catch (err) {
            result.errors.push(`Insurance case ${c.id}: ${String(err)}`)
        }
    }

    return result
}
