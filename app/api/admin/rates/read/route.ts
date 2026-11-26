import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { claudeOffReason } from '@/lib/ai/claude'
import { readRateMessage } from '@/lib/insurance/readRateMessage'
import type { RateRead } from '@/lib/insurance/rateUpdate'

export const maxDuration = 60

// Vercel caps a request body at ~4.5MB.
const MAX_BYTES = 4_000_000
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
// Change when the prompt changes, so an old read isn't reused.
const READ_VERSION = '1'

// POST multipart { bank, text? , file* }  Reads the message; changes no rates.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    let form: FormData
    try { form = await request.formData() } catch { return NextResponse.json({ error: 'Expected a form upload.' }, { status: 400 }) }
    const bank = String(form.get('bank') ?? '').trim()
    const text = String(form.get('text') ?? '').trim()
    const uploads = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0)
    if (!bank || (!text && !uploads.length)) return NextResponse.json({ error: 'Choose a bank, then paste the message or add a file.' }, { status: 400 })
    if (text && uploads.length) return NextResponse.json({ error: 'Read the text and the files separately, so each can be checked against its source.' }, { status: 400 })
    if (uploads.some(f => !EXT[f.type])) return NextResponse.json({ error: 'Files must be PDF, JPG, PNG or WebP.' }, { status: 400 })
    if (uploads.reduce((s, f) => s + f.size, 0) > MAX_BYTES) return NextResponse.json({ error: 'Files are too large (4MB in total).' }, { status: 400 })
    if (text.length > 60_000) return NextResponse.json({ error: 'That message is too long. Paste one bank at a time.' }, { status: 400 })

    const files = await Promise.all(uploads.map(async f => ({ buffer: Buffer.from(await f.arrayBuffer()), mime: f.type })))
    const h = createHash('sha256').update(`${READ_VERSION}\0${bank}\0${text}`)
    for (const f of files) h.update('\0').update(f.buffer)
    const hash = h.digest('hex')

    const db = createAdminClient()
    const saved = await db.from('rate_message_reads').select('result').eq('hash', hash).maybeSingle()
    let read = (saved.data?.result ?? null) as RateRead | null
    const reused = !!read
    if (!read) {
        const off = claudeOffReason('rateUpdate')
        if (off) return NextResponse.json({ error: off }, { status: 503 })
        const result = await readRateMessage(bank, text || null, files)
        if (!result.read) return NextResponse.json({ error: "Couldn't read that message. Try again, or split it into smaller parts." }, { status: 502 })
        if (!result.complete) return NextResponse.json({ error: 'The message was too long to read completely. Split it into smaller parts.' }, { status: 502 })
        read = result.read
        const { error } = await db.from('rate_message_reads').insert({ hash, result: read })
        if (error) console.error('[rates] saving the read failed:', error.message)
    }

    // Keep the first original so a published rate can be traced to it.
    let file_path: string | undefined
    if (files.length) {
        file_path = `${hash}.${EXT[files[0].mime]}`
        const { error } = await db.storage.from('rate-sources').upload(file_path, files[0].buffer, { contentType: files[0].mime, upsert: true })
        if (error) { console.error('[rates] saving the source failed:', error.message); file_path = undefined }
    }
    return NextResponse.json({ read, reused, file_path, file_name: uploads[0]?.name })
}
