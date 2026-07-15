import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty, isAdmin } from '@/lib/permissions'
import { getCurrentSora } from '@/lib/insurance/sora'
import { loadPackages } from '@/lib/insurance/ratesCache'
import { buildCompareReportHtml } from '@/lib/insurance/compareReport'
import { generatePdf } from '@/lib/email/generatePdf'

// POST /api/insurance/rates/compare-pdf
// Body: { packageIds: string[], loan?: number, tenure?: number }
// Returns an A4 PDF of the side-by-side comparison for download.
// Shared resource: any insurance OR property user; agents get published packages only.
export async function POST(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!(canAccessInsurance(profile.role, profile.app_type) || canAccessProperty(profile.role, profile.app_type))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    let body: { packageIds?: unknown; loan?: unknown; tenure?: unknown; clientName?: unknown; advisorName?: unknown }
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

    const admin_ = isAdmin(profile.role)
    let all, sora
    try {
        [all, sora] = await Promise.all([loadPackages(), getCurrentSora()])
    } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load rates' }, { status: 500 })
    }

    // Preserve the order the agent selected; drop anything not visible to them.
    const byId = new Map(all.filter(p => admin_ || p.status === 'published').map(p => [p.id, p]))
    const packages = packageIds.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    if (packages.length < 2) {
        return NextResponse.json({ error: 'Selected packages could not be found' }, { status: 404 })
    }

    try {
        const html = buildCompareReportHtml({
            packages, sora, loan, tenureYears: tenure,
            clientName: typeof body.clientName === 'string' ? body.clientName : undefined,
            advisorName: typeof body.advisorName === 'string' ? body.advisorName : (profile.name ?? undefined),
        })
        const pdf = await generatePdf(html)
        return new NextResponse(pdf as unknown as BodyInit, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="mortgage-package-comparison.pdf"',
                'Cache-Control': 'no-store',
            },
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to generate the comparison PDF'
        console.error('[compare-pdf] failed:', message)
        return NextResponse.json({ error: message }, { status: 502 })
    }
}
