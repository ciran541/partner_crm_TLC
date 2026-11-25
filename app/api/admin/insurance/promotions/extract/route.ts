import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { claudeOffReason } from '@/lib/ai/claude'
import { extractPromotions } from '@/lib/insurance/extractPromotion'

export const maxDuration = 60

// POST /api/admin/insurance/promotions/extract  { bank, text }
// Claude structures a pasted bank promo blast into promotion rows. Saves
// NOTHING — the result goes to the review screen, and only a confirmed save
// writes to the DB. Same human gate as rate-sheet ingestion: an AI reads a
// messy source, a person confirms before agents see it.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { bank, text } = await request.json().catch(() => ({}))
    if (!bank?.trim() || !text?.trim()) {
        return NextResponse.json({ error: "Pick a bank and paste the bank's message." }, { status: 400 })
    }
    const off = claudeOffReason('extractPromotions')
    if (off) return NextResponse.json({ error: off }, { status: 503 })

    const promotions = await extractPromotions(text, bank)
    if (!promotions) {
        // Deliberately generic: this covers a rate limit, a network error and an
        // unparseable response, and the admin's next step is the same for all
        // three. The server log carries the specific cause.
        return NextResponse.json({ error: "Couldn't read that message — the extractor failed or returned something unusable. Try again, or check the paste describes a promotion." }, { status: 502 })
    }

    return NextResponse.json({ promotions })
}
