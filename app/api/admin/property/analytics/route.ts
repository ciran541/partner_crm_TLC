import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { todaySgt } from '@/lib/insurance/promotions'
import { propertyAnalytics, type PropertyAnalyticsCase } from '@/lib/property/adminAnalytics'

/** GET — Basic & Starter dashboard. Drafts and duplicates never count, same as Earnings. */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const admin = createAdminClient()

    // Paged: a single select stops silently at PostgREST's 1,000-row cap.
    const cases: PropertyAnalyticsCase[] = []
    for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from('property_cases')
            .select('id, status, case_type, gross_commission_amount, agent_commission_amount, tlc_commission_amount, commission_status, agent_id, created_at, is_duplicate, follow_up_date, followup_completed_at')
            .order('id').range(from, from + 999)
        if (error) {
            console.error('[property analytics]', error)
            return NextResponse.json({ error: 'Failed to load the dashboard' }, { status: 500 })
        }
        cases.push(...(data as PropertyAnalyticsCase[]))
        if (data.length < 1000) break
    }
    const { data: profiles } = await admin.from('profiles').select('id, name').eq('app_type', 'property')
    const names = Object.fromEntries((profiles ?? []).map(p => [p.id, p.name as string]))
    return NextResponse.json({ data: propertyAnalytics(cases, names, todaySgt()) })
}
