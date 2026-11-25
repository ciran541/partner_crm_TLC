/**
 * POST /api/property/cases/extract-lo
 *
 * Reads a Letter of Offer already uploaded to Supabase Storage and returns
 * the structured mortgage figures Step 3 of "Submit a New Case" prefills
 * from. Writes no row, deletes nothing — pure transcription of a file the
 * client already owns.
 *
 * Takes a STORAGE PATH, not the file bytes, deliberately: Vercel caps a
 * Serverless Function's request body at ~4.5MB at the edge, before this
 * handler ever runs, so a large LO sent directly in the POST body would
 * 413 in production regardless of any limit set here (confirmed against
 * this exact wall in the insurance app's twin of this route). The client
 * uploads the file straight to Storage first (browser -> Storage, no
 * Vercel function in between) and only sends this route the resulting
 * path — a few dozen bytes of JSON — sidestepping the ceiling entirely.
 * This also means the file is already sitting where Step 4 needs it, so
 * submitting the case attaches it without a second upload.
 */

import { NextResponse } from 'next/server'
import { isClaudeConfigured } from '@/lib/ai/claude'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { extractLetterOfOffer, takeLastFailure, toMortgageFields, LO_ACCEPTED_MIME } from '@/lib/property/extractLetterOfOffer'

// A scanned LO through the vision lane is the slow path; give it room.
export const maxDuration = 60

const STORAGE_BUCKET = 'property-documents'

/**
 * Ceiling on what actually gets READ, separate from the 25MB the document
 * uploader accepts for attaching a file to a case. This one is about the AI
 * providers, not Vercel: the request body is base64
 * (~1.33x the raw size), and a huge scan risks the same "garbled table"
 * failure mode the extraction prompt already has to defend against, just
 * worse. A file over this still attaches to the case fine — it just isn't
 * auto-read, and the agent fills the form by hand.
 */
const MAX_EXTRACT_BYTES = 10 * 1024 * 1024

export async function POST(request: Request) {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    if (!isClaudeConfigured('extractLetterOfOffer')) {
        console.error('[extract-lo] ANTHROPIC_API_KEY is not set')
        return NextResponse.json(
            { error: 'Document reading is not configured on this server. Ask your admin to set the AI key.' },
            { status: 503 },
        )
    }

    let body: { path?: string; mime?: string }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
    }

    const { path, mime } = body
    if (!path || typeof path !== 'string') {
        return NextResponse.json({ error: 'No file path given.' }, { status: 400 })
    }
    // Storage RLS (agent_read_own_files) would deny a cross-user path anyway,
    // but failing fast here gives a clear 403 instead of a generic download error.
    if ((path.split('/')[0]) !== auth.userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!mime || !LO_ACCEPTED_MIME.includes(mime as typeof LO_ACCEPTED_MIME[number])) {
        return NextResponse.json({ error: 'Only PDF, JPEG, PNG or WebP files can be read.' }, { status: 415 })
    }

    try {
        const supabase = await createServerSupabaseClient()
        const { data: blob, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(path)
        if (downloadError || !blob) {
            console.error('[extract-lo] storage download failed:', downloadError?.message)
            return NextResponse.json({ error: 'Could not find that file. Try uploading it again.' }, { status: 404 })
        }

        const buffer = Buffer.from(await blob.arrayBuffer())
        if (buffer.length === 0) {
            return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
        }
        if (buffer.length > MAX_EXTRACT_BYTES) {
            return NextResponse.json(
                { error: "That file is larger than we can auto-read (max 10 MB). It's still attached to your case — enter the mortgage details manually below." },
                { status: 413 },
            )
        }

        const data = await extractLetterOfOffer({ buffer, mime })
        if (!data) {
            const failure = takeLastFailure()
            if (failure) {
                return NextResponse.json(
                    failure === 'account'
                        ? { error: 'Document reading is unavailable right now. Enter the details manually and let your admin know.' }
                        : { error: 'Document reading is busy right now. Try again in a minute, or enter the details manually.' },
                    { status: failure === 'account' ? 503 : 429 },
                )
            }
            return NextResponse.json(
                { error: "Couldn't read this file. Enter the details manually." },
                { status: 422 },
            )
        }
        // Pre-mapped into the wizard's package_type/fixed_years/floating_rate_type/
        // year_rates shape here — server-side, alongside the raw figures — so the
        // client component never imports runtime code from this lib file (which
        // dynamically loads pdf-parse) and only consumes plain JSON, same as the
        // insurance extract-lo route's client does with ExtractedLo.
        const mortgageFields = toMortgageFields(data.schedule, data.lockin_years ?? 0)
        return NextResponse.json({ data, mortgageFields })
    } catch (err) {
        console.error('[extract-lo] threw:', String(err))
        return NextResponse.json({ error: 'Extraction failed. Enter the details manually.' }, { status: 500 })
    }
}
