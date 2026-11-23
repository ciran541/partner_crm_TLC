import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty } from '@/lib/permissions'
import { getPublishedArticles, parseNewsPageQuery } from '@/lib/insurance/news'

// GET /api/insurance/resources/news — agent-facing feed.
// Shared resource: any authenticated insurance OR property user can read.
// Only relevant, non-hidden articles are returned.
// Paged: ?offset=&limit=(≤50, default 20)&source=<feed_key> → { data, total }
export async function GET(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const allowed =
        canAccessInsurance(profile.role, profile.app_type) ||
        canAccessProperty(profile.role, profile.app_type)
    if (!allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = await getPublishedArticles(parseNewsPageQuery(searchParams, 20))
    return NextResponse.json(page)
}
