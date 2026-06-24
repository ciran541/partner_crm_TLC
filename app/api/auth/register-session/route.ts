import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { randomUUID } from 'crypto'

export async function POST() {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sessionId = randomUUID()

    const admin = createAdminClient()
    const { error } = await admin
        .from('profiles')
        .update({ current_session_id: sessionId })
        .eq('id', user.id)

    if (error) {
        return NextResponse.json({ error: 'Failed to register session' }, { status: 500 })
    }

    const response = NextResponse.json({ ok: true })
    response.cookies.set('session_guard', sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30, // 30 days
    })
    return response
}
