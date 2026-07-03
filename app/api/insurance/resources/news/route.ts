import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty } from '@/lib/permissions'
import { getPublishedArticles } from '@/lib/insurance/news'

// GET /api/insurance/resources/news — agent-facing feed.
// Shared resource: any authenticated insurance OR property user can read.
// Only relevant, non-hidden articles are returned.
export async function GET() {
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

    const data = await getPublishedArticles()
    return NextResponse.json({ data })
}
