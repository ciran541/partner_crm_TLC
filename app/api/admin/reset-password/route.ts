import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    let body: { id: string; password: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { id, password } = body

    if (!id || !password) {
        return NextResponse.json({ error: 'Missing id or password' }, { status: 400 })
    }

    if (password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(id, { password })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
