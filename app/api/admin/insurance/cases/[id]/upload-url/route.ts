import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'

const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** POST { type } — a one-off upload link into the agent's own folder for this case, so the agent can open the file. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const ext = EXT[body?.type]
    if (!ext) return NextResponse.json({ error: 'Upload a PDF or a photo (JPG, PNG, WebP).' }, { status: 400 })
    const db = createAdminClient()
    const { data: c } = await db.from('cases').select('created_by').eq('id', id).single()
    if (!c) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    const path = `${c.created_by}/${id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`
    const { data, error } = await db.storage.from('insurance-documents').createSignedUploadUrl(path)
    if (error) return NextResponse.json({ error: 'Could not start the upload.' }, { status: 500 })
    return NextResponse.json({ path, token: data.token })
}
