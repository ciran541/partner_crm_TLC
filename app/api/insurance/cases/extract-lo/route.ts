/**
 * POST /api/insurance/cases/extract-lo
 *
 * Reads an uploaded Letter of Offer and returns the structured figures for the
 * Closed-Won form to prefill. Pure transcription — reads no case, writes no row,
 * stores no file (the LO is uploaded to storage separately, on confirm), so this
 * route has no case-scoped data to leak and takes no case id.
 *
 * The caller passes the loan kinds its case type can close; the extractor
 * constrains the model to those.
 */

import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { extractLoanOffer, takeLastFailure, LO_ACCEPTED_MIME } from '@/lib/insurance/extractLoanOffer'
import { CLOSED_LOAN_LABELS } from '@/lib/insurance/closedWon'
import type { ClosedLoanKind } from '@/lib/types'

// A scanned LO through the vision lane is the slow path; give it room.
export const maxDuration = 60

// Total across all pages, and it is Vercel's ceiling that binds here, not ours:
// a Serverless Function request body is capped at ~4.5MB and anything larger is
// rejected at the edge BEFORE this handler runs — so a generous limit here just
// turns into an opaque 413 in production while working fine locally. The client
// downscales images before sending; this is the backstop.
const MAX_BYTES = 4 * 1024 * 1024
/** An LO photographed page by page — generous, but not an unbounded upload. */
const MAX_PAGES = 10

export async function POST(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    // Distinguish "this server has no AI keys" from "the model couldn't read
    // it". Both used to surface as the same generic 422, which is impossible to
    // act on — and the keys living in a local .env.local that never deploys is
    // exactly how a feature works locally and silently does nothing in prod.
    const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY
    const hasGemini = !!process.env.GEMINI_API_KEY
    if (!hasDeepSeek && !hasGemini) {
        console.error('[extract-lo] no AI keys configured — set DEEPSEEK_API_KEY and GEMINI_API_KEY')
        return NextResponse.json(
            { error: 'Document reading is not configured on this server. Ask your admin to set the AI keys.' },
            { status: 503 },
        )
    }
    // Images and scanned PDFs can ONLY be read by the vision lane.
    if (!hasGemini) {
        console.warn('[extract-lo] GEMINI_API_KEY missing — images and scanned PDFs cannot be read')
    }

    let form: FormData
    try {
        form = await request.formData()
    } catch {
        return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 })
    }

    // Several files = consecutive pages of ONE Letter of Offer, in the order
    // sent. An LO photographed page by page must be read as a single document.
    const uploads = form.getAll('file').filter((f): f is File => f instanceof File)
    if (!uploads.length) {
        return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
    }
    if (uploads.length > MAX_PAGES) {
        return NextResponse.json({ error: `Please attach at most ${MAX_PAGES} pages at a time.` }, { status: 400 })
    }
    for (const file of uploads) {
        if (file.size === 0) {
            return NextResponse.json({ error: `"${file.name}" is empty.` }, { status: 400 })
        }
        if (!LO_ACCEPTED_MIME.includes(file.type as typeof LO_ACCEPTED_MIME[number])) {
            return NextResponse.json({ error: 'Only PDF, JPEG, PNG or WebP files can be read.' }, { status: 415 })
        }
    }
    // Only Gemini can read pixels. Without it an image upload would run the
    // whole pipeline and fail with a generic "couldn't read this file".
    if (!hasGemini && uploads.some(f => f.type.startsWith('image/'))) {
        return NextResponse.json(
            { error: 'Reading photos and screenshots is not configured on this server. Upload the PDF instead, or ask your admin to set GEMINI_API_KEY.' },
            { status: 503 },
        )
    }

    const totalBytes = uploads.reduce((sum, f) => sum + f.size, 0)
    if (totalBytes > MAX_BYTES) {
        return NextResponse.json(
            { error: 'Those files are too large to read. Try fewer pages, or a smaller scan.' },
            { status: 413 },
        )
    }

    // Only kinds the form actually has rows for — anything else is ignored
    // rather than trusted, so a crafted request can't widen the enum.
    const kinds = String(form.get('kinds') ?? '')
        .split(',')
        .map(k => k.trim())
        .filter((k): k is ClosedLoanKind => k in CLOSED_LOAN_LABELS)
    if (!kinds.length) {
        return NextResponse.json({ error: 'No loan kinds supplied.' }, { status: 400 })
    }

    try {
        const pages = await Promise.all(uploads.map(async f => ({
            buffer: Buffer.from(await f.arrayBuffer()),
            mime: f.type,
        })))
        const data = await extractLoanOffer(pages, kinds)
        if (!data) {
            // A spent daily quota is a wait-or-upgrade problem, not a bad
            // document — saying "couldn't read this file" would send the agent
            // hunting for a better scan that was never the issue.
            if (takeLastFailure() === 'rate_limited') {
                return NextResponse.json(
                    { error: "The document-reading service has hit today's usage limit. Enter the details manually, or try again tomorrow." },
                    { status: 429 },
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
    }
}
