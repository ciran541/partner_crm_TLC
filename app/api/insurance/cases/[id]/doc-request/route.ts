import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getServerUser } from '@/lib/auth/getUser'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessInsurance, isAdmin } from '@/lib/permissions'
import { sendDocRequest } from '@/lib/email/sendDocRequest'

// POST /api/insurance/cases/[id]/doc-request
// Ensures the case has a shareable doc-request token and returns the public URL.
// With { sendEmail: true }, also emails the link to the client.
export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: caseId } = await params
    const body = await req.json().catch(() => ({}))
    const sendEmail = body?.sendEmail === true

    const admin = createAdminClient()
    const { data: row, error } = await admin
        .from('cases')
        .select('id, created_by, client_name, client_email, doc_request_token, profiles(name)')
        .eq('id', caseId)
        .maybeSingle()

    if (error) {
        console.error('[doc-request] case query failed:', error.message)
        return NextResponse.json({ error: `Failed to load case: ${error.message}` }, { status: 500 })
    }
    if (!row) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }
    // Admin client bypasses RLS, so ownership must be checked explicitly — otherwise
    // any insurance agent could mint a share link for another agent's case.
    if (row.created_by !== user.id && !isAdmin(profile.role)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Reuse the existing token if present, otherwise mint and persist one.
    let token = row.doc_request_token as string | null
    if (!token) {
        token = randomUUID()
        const { error: updateErr } = await admin
            .from('cases')
            .update({ doc_request_token: token })
            .eq('id', caseId)
        if (updateErr) {
            console.error('[doc-request] token save failed:', updateErr.message)
            return NextResponse.json({ error: 'Could not create the share link' }, { status: 500 })
        }
    }

    const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const url = `${base}/doc-request/${token}`

    let emailed = false
    if (sendEmail) {
        if (!row.client_email) {
            return NextResponse.json({ error: 'No client email on this case. Add it in the case details first.' }, { status: 422 })
        }
        const agentProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
        try {
            await sendDocRequest({
                clientEmail: row.client_email,
                clientName: row.client_name ?? undefined,
                agentEmail: user.email ?? undefined,
                agentName: profile.name ?? agentProfile?.name ?? undefined,
                url,
            })
            emailed = true
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Failed to send the email'
            console.error('[doc-request] email failed:', message)
            return NextResponse.json({ error: message }, { status: 502 })
        }
    }

    return NextResponse.json({ url, token, emailed })
}
