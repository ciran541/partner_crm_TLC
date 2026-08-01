import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty } from '@/lib/permissions'
import { getOrCreateSummary } from '@/lib/insurance/news'
import { rateLimitUser } from '@/lib/rateLimit'

// POST /api/insurance/resources/news/[id]/summarize
// Returns the cached AI summary if present, else generates and caches one.
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> },
) {
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

    // Only the first call for a given article costs anything (getOrCreateSummary
    // caches into the summary column), so this bounds the miss path — someone
    // walking every article, or retrying a failing one.
    const limited = await rateLimitUser(user.id, 'news-summarize', 'ai')
    if (limited) return limited

    const { id } = await params
    const summary = await getOrCreateSummary(id)
    if (!summary) return NextResponse.json({ error: 'Could not generate summary' }, { status: 502 })
    return NextResponse.json({ summary })
}
