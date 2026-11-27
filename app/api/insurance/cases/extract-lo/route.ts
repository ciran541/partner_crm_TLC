/**
 * POST /api/insurance/cases/extract-lo
 *
 * Reads a Letter of Offer and returns the structured figures for the
 * Closed-Won form to prefill. Pure transcription — reads no case, writes no row.
 *
 * The browser uploads the pages to the `insurance-documents` bucket first and
 * sends their paths here. Sending the files in the request itself capped an LO
 * at ~4.5MB (Vercel rejects a bigger body before the route runs); storage takes
 * 25MB a file, same as Basic & Starter.
 *   - `<user>/<case>/…`  a PDF, kept: the same object becomes the case's LO
 *     document on confirm, so a 25MB scan is uploaded once, not twice.
 *   - `<user>/lo-read/…` a downscaled image copy, deleted here after reading
 *     (the full-size original is uploaded on confirm).
 *
 * The caller passes the loan kinds its case type can close; the extractor
 * constrains the model to those.
 */

import { NextResponse } from 'next/server'
import { isClaudeConfigured } from '@/lib/ai/claude'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractLoanOffer, takeLastFailure, LO_ACCEPTED_MIME } from '@/lib/insurance/extractLoanOffer'
import { CLOSED_LOAN_LABELS } from '@/lib/insurance/closedWon'
import type { ClosedLoanKind } from '@/lib/types'

// A scanned LO through the vision lane is the slow path; give it room.
export const maxDuration = 60

const BUCKET = 'insurance-documents'
/** Per file. Matches the bucket's own limit (migration 20261218000000). */
const MAX_FILE_BYTES = 25 * 1024 * 1024
/** An LO photographed page by page — generous, but not an unbounded upload. */
const MAX_PAGES = 10

export async function POST(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    // Distinguish "this server has no AI keys" from "the model couldn't read
    // it". Both used to surface as the same generic 422, which is impossible to
    // act on — and the keys living in a local .env.local that never deploys is
    // exactly how a feature works locally and silently does nothing in prod.
    if (!isClaudeConfigured('extractLoanOffer')) {
        console.error('[extract-lo] ANTHROPIC_API_KEY is not set')
        return NextResponse.json(
            { error: 'Document reading is not configured on this server. Ask your admin to set the AI key.' },
            { status: 503 },
        )
    }

    let body: { pages?: unknown; kinds?: unknown }
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
    }

    // Several pages = consecutive pages of ONE Letter of Offer, in the order
    // sent. An LO photographed page by page must be read as a single document.
    const pages = (Array.isArray(body.pages) ? body.pages : []) as { path?: unknown; mime?: unknown }[]
    if (!pages.length) {
        return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
    }
    if (pages.length > MAX_PAGES) {
        return NextResponse.json({ error: `Please attach at most ${MAX_PAGES} pages at a time.` }, { status: 400 })
    }
    const own = `${auth.userId}/`
    const tempPrefix = `${auth.userId}/lo-read/`
    for (const p of pages) {
        // Storage RLS would refuse another agent's file anyway; this is the
        // clear 403 — and it keeps the clean-up below inside the caller's folder.
        if (typeof p.path !== 'string' || !p.path.startsWith(own) || p.path.includes('..')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        if (!LO_ACCEPTED_MIME.includes(p.mime as typeof LO_ACCEPTED_MIME[number])) {
            return NextResponse.json({ error: 'Only PDF, JPEG, PNG or WebP files can be read.' }, { status: 415 })
        }
    }
    const paths = pages.map(p => p.path as string)

    // Only kinds the form actually has rows for — anything else is ignored
    // rather than trusted, so a crafted request can't widen the enum.
    const kinds = (Array.isArray(body.kinds) ? body.kinds : [])
        .map(k => String(k).trim())
        .filter((k): k is ClosedLoanKind => k in CLOSED_LOAN_LABELS)
    if (!kinds.length) {
        return NextResponse.json({ error: 'No loan kinds supplied.' }, { status: 400 })
    }

    try {
        const supabase = await createServerSupabaseClient()
        const files = []
        for (let i = 0; i < paths.length; i++) {
            const { data: blob, error } = await supabase.storage.from(BUCKET).download(paths[i])
            if (error || !blob) {
                console.error('[extract-lo] storage download failed:', error?.message)
                return NextResponse.json({ error: 'Could not find that file. Try attaching it again.' }, { status: 404 })
            }
            const buffer = Buffer.from(await blob.arrayBuffer())
            if (!buffer.length) return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
            if (buffer.length > MAX_FILE_BYTES) {
                return NextResponse.json({ error: 'That file is larger than 25 MB.' }, { status: 413 })
            }
            files.push({ buffer, mime: pages[i].mime as string })
        }

        const data = await extractLoanOffer(files, kinds)
        if (!data) {
            // A busy service or an empty AI balance is not a bad
            // document — saying "couldn't read this file" would send the agent
            // hunting for a better scan that was never the issue.
            const failure = takeLastFailure()
            if (failure === 'too_large') {
                return NextResponse.json(
                    { error: "That scan is too large to read automatically. It's still attached to the case." },
                    { status: 413 },
                )
            }
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
        return NextResponse.json({ data })
    } catch (err) {
        console.error('[extract-lo] threw:', String(err))
        return NextResponse.json({ error: 'Extraction failed. Enter the details manually.' }, { status: 500 })
    } finally {
        // Reading copies only; agents have no delete grant on the bucket.
        const temp = paths.filter(p => p.startsWith(tempPrefix))
        if (temp.length) {
            const { error } = await createAdminClient().storage.from(BUCKET).remove(temp)
            if (error) console.error('[extract-lo] temp clean-up failed:', error.message)
        }
    }
}
