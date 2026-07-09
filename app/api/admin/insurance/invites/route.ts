import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const supabaseAdmin = createAdminClient()
    const { data, error } = await supabaseAdmin
        .from('agent_invites')
        .select('*')
        .order('created_at', { ascending: false })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const body = await request.json().catch(() => ({}))
        const invited_name: string | null = body.invited_name || null
        const invited_email: string | null = body.invited_email || null

        const token = crypto.randomBytes(24).toString('hex')
        const supabaseAdmin = createAdminClient()

        const { data, error } = await supabaseAdmin
            .from('agent_invites')
            .insert({
                token,
                app_type: 'insurance',
                role: 'agent',
                invited_name,
                invited_email,
                created_by: auth.userId,
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        const url = `${process.env.NEXT_PUBLIC_APP_URL}/insurance/signup?token=${token}`
        return NextResponse.json({ invite: data, url })
    } catch (error: any) {
        console.error('Create Invite API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}

export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const { id, status } = await request.json()

        if (!id || status !== 'revoked') {
            return NextResponse.json({ error: 'Only revoking a pending invite is supported' }, { status: 400 })
        }

        const supabaseAdmin = createAdminClient()
        const { error } = await supabaseAdmin
            .from('agent_invites')
            .update({ status: 'revoked' })
            .eq('id', id)
            .eq('status', 'pending')

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Revoke Invite API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
