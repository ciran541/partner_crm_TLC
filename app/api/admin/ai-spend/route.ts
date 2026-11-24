import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { todaySgt } from '@/lib/insurance/promotions'

export const dynamic = 'force-dynamic'

/** GET: AI usage by day, feature, model and environment. */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { data, error } = await createAdminClient().rpc('ai_spend')
    if (error) {
        console.error('[admin/ai-spend]', error)
        return NextResponse.json({ error: 'Could not load AI spend. Please refresh.' }, { status: 500 })
    }
    return NextResponse.json({ ...data, today: todaySgt() })
}
