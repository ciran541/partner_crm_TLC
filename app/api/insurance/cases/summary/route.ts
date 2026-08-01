import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import type { CaseSummary } from '@/lib/types/caseSummary'

/**
 * GET /api/insurance/cases/summary — dashboard aggregates.
 *
 * The Analytics and Pipeline screens never needed case rows, only the numbers
 * derived from them. They used to download up to a thousand cases and total
 * them in the browser, which meant the totals only ever covered the rows that
 * survived the cap. This returns a few hundred bytes computed over every
 * matching row.
 *
 * Query params
 *   agent=  created_by uuid — admin only, ignored for agents
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const agent = searchParams.get('agent')?.trim() || null

    const admin = createAdminClient()
    const { data, error } = await admin.rpc('case_summary', {
        // Scoping decided from the session, never from the request.
        p_viewer_id: auth.userId,
        p_is_admin: auth.isAdmin,
        p_agent: auth.isAdmin ? agent : null,
    })

    if (error) {
        console.error('[GET /api/insurance/cases/summary]', error)
        return NextResponse.json({ error: 'Failed to load summary' }, { status: 500 })
    }

    return NextResponse.json({
        summary: data as CaseSummary,
        isAdmin: auth.isAdmin,
    })
}
