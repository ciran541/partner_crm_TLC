import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty, isAdmin } from '@/lib/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { ARCHIVE_BUCKET } from '@/lib/insurance/bankIntelligence'

// GET /api/insurance/bank-intelligence/archive?id=<report id> — serves our own
// copy of a report whose source is overwritten in place (UOB's FX forecast), so
// an older summary's "Original PDF" opens the edition it was written from.
// The copies are the bank's copyrighted PDFs, so the bucket is private and this
// route applies the same audience as the agent feed: any insurance or property
// user, published + non-hidden reports only; admins can open drafts to review.
export async function GET(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = isAdmin(profile.role)
    if (!admin && !canAccessInsurance(profile.role, profile.app_type) && !canAccessProperty(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const db = createAdminClient()
    const { data: report } = await db
        .from('bank_intelligence_reports')
        .select('archive_path, is_published, hidden')
        .eq('id', id)
        .maybeSingle()
    if (!report?.archive_path || (!admin && (!report.is_published || report.hidden))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { data: blob, error } = await db.storage.from(ARCHIVE_BUCKET).download(report.archive_path)
    if (error || !blob) return NextResponse.json({ error: 'File unavailable' }, { status: 502 })

    const filename = report.archive_path.split('/').pop() ?? 'report.pdf'
    return new NextResponse(blob, {
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${filename}"`,
            'Cache-Control': 'private, max-age=3600',
        },
    })
}
