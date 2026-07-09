import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance, canAccessProperty } from '@/lib/permissions'
import { getPublishedReports } from '@/lib/insurance/bankIntelligence'

// GET /api/insurance/bank-intelligence — agent-facing feed.
// Shared resource: any authenticated insurance OR property user can read.
// Only published, non-hidden reports are returned.
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

    const data = await getPublishedReports()
    return NextResponse.json({ data })
}
