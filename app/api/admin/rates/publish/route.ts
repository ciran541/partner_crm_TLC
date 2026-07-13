import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { invalidatePackagesCache } from '@/lib/insurance/ratesCache'

// POST /api/admin/rates/publish  { ids: string[], status?: 'published' | 'draft' }
// Bulk set publish status (default 'published') so admins don't toggle one by one.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { ids, status } = await request.json().catch(() => ({}))
    if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: 'No packages selected' }, { status: 400 })
    }
    const next = status === 'draft' ? 'draft' : 'published'

    const admin = createAdminClient()
    const { error } = await admin.from('mortgage_packages').update({ status: next }).in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    invalidatePackagesCache()
    return NextResponse.json({ success: true, count: ids.length, status: next })
}
