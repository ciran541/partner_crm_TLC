import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessInsurance, isAdmin } from '@/lib/permissions'
import { getCurrentSora } from '@/lib/insurance/sora'
import { loadPackages } from '@/lib/insurance/ratesCache'
import { buildCompareReportHtml } from '@/lib/insurance/compareReport'
import { generatePdf } from '@/lib/email/generatePdf'
import { sendPackageComparison } from '@/lib/email/sendPackageComparison'

// POST /api/insurance/cases/[id]/send-comparison
// Body: { packageIds: string[], loan?: number, tenure?: number }
// Builds a comparison PDF and emails it to the case's client (cc the agent).
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: caseId } = await params

    let body: { packageIds?: unknown; loan?: unknown; tenure?: unknown }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const packageIds = Array.isArray(body.packageIds) ? body.packageIds.filter((x): x is string => typeof x === 'string') : []
    if (packageIds.length < 2 || packageIds.length > 3) {
        return NextResponse.json({ error: 'Select 2–3 packages to compare' }, { status: 422 })
    }
    const loan = typeof body.loan === 'number' && body.loan >= 100_000 ? body.loan : null
    const tenure = typeof body.tenure === 'number' && body.tenure >= 5 && body.tenure <= 35 ? body.tenure : null

    const admin = createAdminClient()
    const { data: row, error } = await admin
        .from('cases')
        .select('id, created_by, client_name, client_email, profiles(name)')
        .eq('id', caseId)
        .maybeSingle()

    if (error) {
        console.error('[send-comparison] case query failed:', error.message)
        return NextResponse.json({ error: `Failed to load case: ${error.message}` }, { status: 500 })
    }
    if (!row) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }
    // Admin client bypasses RLS, so enforce ownership explicitly (agents own only
    // their cases; admins see all).
    if (row.created_by !== user.id && !isAdmin(profile.role)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
    if (!row.client_email) {
        return NextResponse.json({ error: 'No client email on this case. Add it in the case details first.' }, { status: 422 })
    }

    const agentProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    const agentName: string = profile.name ?? agentProfile?.name ?? ''
    const agentEmail: string | undefined = user.email ?? undefined

    let all, sora
    try {
        [all, sora] = await Promise.all([loadPackages(), getCurrentSora()])
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load rates' }, { status: 500 })
    }
    // Cases can compare published packages only (drafts never reach a client).
    const byId = new Map(all.filter(p => p.status === 'published').map(p => [p.id, p]))
    const packages = packageIds.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    if (packages.length < 2) {
        return NextResponse.json({ error: 'Selected packages could not be found' }, { status: 404 })
    }

    try {
        const html = buildCompareReportHtml({
            packages, sora, loan, tenureYears: tenure,
            clientName: row.client_name ?? undefined,
            advisorName: agentName || undefined,
        })
        const pdfBuffer = await generatePdf(html)
        await sendPackageComparison({
            clientEmail: row.client_email,
            clientName: row.client_name ?? undefined,
            agentEmail,
            agentName: agentName || undefined,
            packageCount: packages.length,
            pdfBuffer,
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to generate or send the comparison'
        console.error('[send-comparison] failed:', message)
        return NextResponse.json({ error: message }, { status: 502 })
    }

    return NextResponse.json({ ok: true, sentTo: row.client_email })
}
