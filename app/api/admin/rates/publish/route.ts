import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { editBank, findPackage, rateErrorResponse } from '@/lib/insurance/rateMaster'

// POST /api/admin/rates/publish  { ids: string[], status?: 'published' | 'draft' }
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const { ids, status } = await request.json().catch(() => ({}))
        if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: 'No packages selected' }, { status: 400 })
        const next = status === 'draft' ? 'draft' as const : 'published' as const
        const banks = new Set((await Promise.all(ids.map((id: string) => findPackage(id)))).map(p => p.bank))
        for (const bank of banks) {
            await editBank(bank, auth.userId, next === 'draft' ? 'Moved to draft' : 'Published drafts',
                ps => ps.map(p => ids.includes(p.id) ? { ...p, status: next } : p))
        }
        return NextResponse.json({ success: true, count: ids.length, status: next })
    } catch (e) { return rateErrorResponse(e) }
}
