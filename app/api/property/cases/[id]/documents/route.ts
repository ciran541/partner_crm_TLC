import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { isAdmin } from '@/lib/permissions'

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const { id: caseId } = await params
    const admin = createAdminClient()

    const { data: caseData } = await admin
        .from('property_cases')
        .select('agent_id')
        .eq('id', caseId)
        .single()

    if (!caseData) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    const { data: profile } = await admin
        .from('profiles')
        .select('role')
        .eq('id', auth.userId)
        .single()

    const userIsAdmin = profile ? isAdmin(profile.role as 'admin' | 'super_admin' | 'agent') : false

    if (!userIsAdmin && (caseData as { agent_id: string }).agent_id !== auth.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let body: { file_url: string; file_name: string; file_type: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { file_url, file_name, file_type } = body
    if (!file_url || !file_name || !file_type) {
        return NextResponse.json({ error: 'file_url, file_name, and file_type are required' }, { status: 400 })
    }

    const { data: doc, error } = await admin
        .from('property_case_documents')
        .insert({ case_id: caseId, file_url, file_name, file_type, uploaded_by: auth.userId })
        .select()
        .single()

    if (error || !doc) {
        console.error('Document insert error:', error)
        return NextResponse.json({ error: 'Failed to save document' }, { status: 500 })
    }

    return NextResponse.json({ data: doc }, { status: 201 })
}
