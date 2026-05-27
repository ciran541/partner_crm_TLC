import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'

interface AgentProfileFromSheet {
    old_id: string
    email: string | null
    full_name: string | null
    name: string | null
    role: string
    mobile: string | null
    cea_registration_no: string | null
    agency_name: string | null
    app_type: string
    status: string
    joined_at: string | null
    created_at: string | null
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    let body: { agents: AgentProfileFromSheet[]; _secret: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const secret = process.env.APPS_SCRIPT_SECRET
    if (!secret || body._secret !== secret) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!Array.isArray(body.agents) || body.agents.length === 0) {
        return NextResponse.json({ error: 'No agents provided' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Load all auth users once — used to look up by email for each agent
    const { data: allUsersData, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (listError) {
        return NextResponse.json({ error: 'Failed to list auth users: ' + listError.message }, { status: 500 })
    }
    const authUsersByEmail = new Map(
        (allUsersData?.users ?? []).map(u => [u.email?.toLowerCase(), u])
    )

    const results: {
        email: string | null
        old_id: string
        new_id: string | null
        cases_updated: number
        status: 'remapped' | 'already_matched' | 'not_registered' | 'error'
        error?: string
    }[] = []

    for (const agent of body.agents) {
        // Skip agents with no email — can't match without it
        if (!agent.email) {
            results.push({ email: null, old_id: agent.old_id, new_id: null, cases_updated: 0, status: 'error', error: 'No email in backup' })
            continue
        }

        try {
            // Find the agent's new UUID by email
            const matchedUser = authUsersByEmail.get(agent.email.toLowerCase())

            if (!matchedUser) {
                // Agent hasn't re-registered yet
                results.push({ email: agent.email, old_id: agent.old_id, new_id: null, cases_updated: 0, status: 'not_registered' })
                continue
            }

            const newId = matchedUser.id

            if (newId === agent.old_id) {
                // UUID didn't change — nothing to remap, just ensure profile data is up to date
                await admin.from('profiles').upsert({
                    id: newId,
                    name: agent.name,
                    full_name: agent.full_name,
                    role: agent.role,
                    mobile: agent.mobile,
                    cea_registration_no: agent.cea_registration_no,
                    agency_name: agent.agency_name,
                    app_type: agent.app_type,
                    status: agent.status,
                })
                results.push({ email: agent.email, old_id: agent.old_id, new_id: newId, cases_updated: 0, status: 'already_matched' })
                continue
            }

            // Re-map all cases from old ID to new ID
            const { data: remappedCases } = await admin
                .from('property_cases')
                .update({ agent_id: newId })
                .eq('agent_id', agent.old_id)
                .select('id')
            const casesUpdated = remappedCases?.length ?? 0

            // Upsert profile with new ID — restores all saved details
            await admin.from('profiles').upsert({
                id: newId,
                name: agent.name,
                full_name: agent.full_name,
                role: agent.role,
                mobile: agent.mobile,
                cea_registration_no: agent.cea_registration_no,
                agency_name: agent.agency_name,
                app_type: agent.app_type,
                status: agent.status,
            })

            // Remove stale old profile row if it still exists
            await admin.from('profiles').delete().eq('id', agent.old_id)

            results.push({
                email: agent.email,
                old_id: agent.old_id,
                new_id: newId,
                cases_updated: casesUpdated ?? 0,
                status: 'remapped',
            })
        } catch (err) {
            results.push({
                email: agent.email,
                old_id: agent.old_id,
                new_id: null,
                cases_updated: 0,
                status: 'error',
                error: String(err),
            })
        }
    }

    const remapped = results.filter(r => r.status === 'remapped').length
    const notRegistered = results.filter(r => r.status === 'not_registered').length
    const alreadyMatched = results.filter(r => r.status === 'already_matched').length
    const errors = results.filter(r => r.status === 'error').length

    return NextResponse.json({
        summary: { remapped, not_registered: notRegistered, already_matched: alreadyMatched, errors },
        results,
    })
}
