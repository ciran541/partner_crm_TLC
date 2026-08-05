import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { invalidatePromotionsCache } from '@/lib/insurance/promotionsCache'
import { PROMO_AUDIENCES, BENEFIT_TYPES, WINDOW_BASES } from '@/lib/types/promotions'
import type { BankPromotion, BankPromotionInput, PromotionTier } from '@/lib/types/promotions'
import type { CaseType } from '@/lib/types/insurance'

// Admin CRUD for bank promotions. Guarded by requireAdminUser().
//   GET                       → every promotion, expired ones included
//   POST   { input }          → create one
//   POST   { inputs: [...] }  → create several (the ingestion review screen —
//                               one pasted message routinely yields a client
//                               rebate AND an agent incentive)
//   PATCH  { id, input }      → update
//   PATCH  { id, status }     → publish / unpublish without a full payload
//   DELETE ?id=               → delete

const ALLOWED_CASE_TYPES: CaseType[] = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function num(v: unknown): number | null {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

/** Keep only well-formed YYYY-MM-DD; anything else is stored as "not set". */
function isoDate(v: unknown): string | null {
    if (!v) return null
    const s = String(v).trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null
}

/**
 * Tiers are re-validated here rather than trusted from the client, because they
 * decide a dollar figure quoted to a client. Sorted ascending on the way in so
 * resolveTier()'s first-match rule lands on the lower band at a contested
 * boundary no matter what order the reviewer left the rows in.
 */
function toTiers(raw: unknown): PromotionTier[] {
    if (!Array.isArray(raw)) return []
    const tiers: PromotionTier[] = []
    for (const t of raw) {
        if (!t || typeof t !== 'object') continue
        const o = t as Record<string, unknown>
        const amount = num(o.amount)
        const percent = num(o.percent)
        if (amount == null && percent == null) continue
        const min_loan = num(o.min_loan) ?? 0
        const max_loan = num(o.max_loan)
        const tier: PromotionTier = {
            min_loan,
            max_loan: max_loan != null && max_loan >= min_loan ? max_loan : null,
        }
        if (amount != null) tier.amount = amount
        else tier.percent = percent!
        tiers.push(tier)
    }
    return tiers.sort((a, b) => a.min_loan - b.min_loan)
}

function toRow(input: BankPromotionInput) {
    return {
        bank: String(input.bank ?? '').trim(),
        title: String(input.title ?? '').trim(),
        audience: pick(input.audience, PROMO_AUDIENCES, 'agent'),
        benefit_type: pick(input.benefit_type, BENEFIT_TYPES, 'other'),
        benefit_tiers: toTiers(input.benefit_tiers),
        applies_to: Array.isArray(input.applies_to)
            ? input.applies_to.filter((c): c is CaseType => ALLOWED_CASE_TYPES.includes(c))
            : [],
        window_basis: pick(input.window_basis, WINDOW_BASES, 'submission'),
        starts_on: isoDate(input.starts_on),
        ends_on: isoDate(input.ends_on),
        conditions: Array.isArray(input.conditions)
            ? input.conditions.map(c => String(c).trim()).filter(Boolean)
            : [],
        clawback_years: input.clawback_years == null ? null : Math.round(num(input.clawback_years) ?? 0) || null,
        affects_ltv: input.affects_ltv === true,
        source_text: input.source_text?.trim() || null,
        notes: input.notes?.trim() || null,
        status: input.status === 'published' ? 'published' : 'draft',
    }
}

const invalid = (input: BankPromotionInput | undefined) => !input?.bank?.trim() || !input?.title?.trim()

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()
    const { data, error } = await admin
        .from('bank_promotions')
        .select('*')
        .order('ends_on', { ascending: false, nullsFirst: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ data: (data ?? []) as BankPromotion[] })
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const inputs: BankPromotionInput[] | undefined = Array.isArray(body?.inputs)
        ? body.inputs
        : body?.input ? [body.input] : undefined

    if (!inputs?.length) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
    if (inputs.some(invalid)) {
        return NextResponse.json({ error: 'Every promotion needs a bank and a title' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.from('bank_promotions').insert(inputs.map(toRow)).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    invalidatePromotionsCache()
    return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const { id, input, status } = body as { id?: string; input?: BankPromotionInput; status?: string }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    // Publish toggle — a one-field update, so it doesn't need a full payload.
    const patch = input
        ? (invalid(input) ? null : toRow(input))
        : status === 'published' || status === 'draft' ? { status } : null
    if (!patch) return NextResponse.json({ error: 'Missing or invalid input' }, { status: 400 })

    const admin = createAdminClient()
    const { data, error } = await admin.from('bank_promotions').update(patch).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    invalidatePromotionsCache()
    return NextResponse.json({ data })
}

export async function DELETE(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('bank_promotions').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    invalidatePromotionsCache()
    return NextResponse.json({ success: true })
}
