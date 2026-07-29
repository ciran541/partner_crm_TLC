import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { extractPackages } from '@/lib/insurance/extractPackages'

export const maxDuration = 60

// POST /api/admin/rates/extract  { bank, text }
// Gemini structures the pasted sheet block into packages. Saves NOTHING — the
// result goes to the review screen, and only a confirmed replace writes to the DB.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { bank, text } = await request.json().catch(() => ({}))
    if (!bank?.trim() || !text?.trim()) {
        return NextResponse.json({ error: 'Pick a bank and paste the rate block.' }, { status: 400 })
    }
    if (!process.env.DEEPSEEK_API_KEY) {
        return NextResponse.json({ error: 'Extraction needs DEEPSEEK_API_KEY — not configured.' }, { status: 503 })
    }

    const packages = await extractPackages(text, bank)
    if (!packages) {
        // Kept generic: this fires for a rate limit, a network error, or a
        // response that did not parse, and the admin's next step is the same
        // either way. The server log carries the specific cause.
        return NextResponse.json({ error: "Couldn't read that rate block — the extractor failed or returned something unusable. Try again, or check the paste is a rate table." }, { status: 502 })
    }

    return NextResponse.json({ packages })
}
