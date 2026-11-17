import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { sendAgentInviteEmail } from '@/lib/email/sendAgentAuthEmail'
import { logAdminAction } from '@/lib/auth/auditLog'
import { inviteTargetForPlan, invitePlanName, inviteSignupPath, isInvitePlan } from '@/lib/auth/invites'

// Path stays /api/admin/insurance/invites for compatibility, but this now
// issues invites for every plan (Premium, Basic, Starter) — see lib/auth/invites.

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
        // Which plan this invite grants. Omitted → Premium, so any older
        // client that doesn't send it keeps the original behaviour.
        const plan = body.plan ?? 'premium'
        if (!isInvitePlan(plan)) {
            return NextResponse.json({ error: 'Plan must be premium, basic or starter.' }, { status: 400 })
        }
        const target = inviteTargetForPlan(plan)

        // Required — an invite with no email attached could be claimed by
        // anyone who gets hold of the link, active immediately, with zero
        // identity check. The admin already knows who paid by this point.
        if (!invited_email) {
            return NextResponse.json({ error: "The agent's email is required to generate an invite." }, { status: 400 })
        }

        const token = crypto.randomBytes(24).toString('hex')
        const supabaseAdmin = createAdminClient()

        const { data, error } = await supabaseAdmin
            .from('agent_invites')
            .insert({
                token,
                app_type: target.app_type,
                subscription_tier: target.subscription_tier,
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

        const url = `${process.env.NEXT_PUBLIC_APP_URL}${inviteSignupPath(target.app_type)}?token=${token}`
        const planLabel = invitePlanName(target)

        let emailed = false
        if (invited_email) {
            try {
                await sendAgentInviteEmail({ to: invited_email, name: invited_name, inviteUrl: url, planName: planLabel })
                emailed = true
            } catch (emailError) {
                console.error('Failed to send invite email:', emailError)
            }
        }

        await logAdminAction({
            actorId: auth.userId,
            action: 'invite_created',
            targetType: 'agent_invite',
            targetId: data.id,
            details: { invited_email, invited_name, emailed, plan: planLabel },
        })

        return NextResponse.json({ invite: data, url, emailed })
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

        await logAdminAction({
            actorId: auth.userId,
            action: 'invite_revoked',
            targetType: 'agent_invite',
            targetId: id,
        })

        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('Revoke Invite API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
