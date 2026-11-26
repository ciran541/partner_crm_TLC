import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadBank, publishBank, rateErrorResponse, type RateSource } from '@/lib/insurance/rateMaster'
import { invalidatePackagesCache } from '@/lib/insurance/ratesCache'
import type { BankChange, RecentSource } from '@/lib/insurance/rateUpdate'

// GET ?bank=  the bank's master, saved answers, note and recent history.
export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const bank = new URL(request.url).searchParams.get('bank')?.trim()
    if (!bank) return NextResponse.json({ error: 'Choose a bank' }, { status: 400 })
    try {
        const db = createAdminClient()
        const [master, aliases, note, versions] = await Promise.all([
            loadBank(bank),
            db.from('rate_aliases').select('id, banker, phrase, ladder_key').eq('bank', bank).order('created_at', { ascending: false }),
            db.from('bank_rate_notes').select('note').eq('bank', bank).maybeSingle(),
            db.from('rate_versions').select('id, summary, source, changes, restored_from, created_by, created_at').eq('bank', bank).order('created_at', { ascending: false }).limit(50),
        ])
        const failed = aliases.error ?? note.error ?? versions.error
        if (failed) return NextResponse.json({ error: failed.message }, { status: 500 })

        const rows = versions.data ?? []
        const userIds = [...new Set(rows.map(v => v.created_by).filter(Boolean))] as string[]
        const people = userIds.length ? await db.from('profiles').select('id, name, full_name').in('id', userIds) : { data: [] }
        const nameOf = new Map((people.data ?? []).map(p => [p.id, p.full_name || p.name || 'Admin']))

        // Newest first, so the first entry per package is the latest.
        const recent = new Map<string, RecentSource>()
        for (const v of rows) {
            const banker = (v.source as RateSource | null)?.banker
            for (const c of v.changes as BankChange[]) {
                if (!recent.has(c.package_id)) recent.set(c.package_id, { package_id: c.package_id, banker: banker ?? '', on: v.created_at.slice(0, 10) })
            }
        }
        return NextResponse.json({
            ...master, aliases: aliases.data, note: note.data?.note ?? '', recent: [...recent.values()],
            versions: rows.map(v => ({ ...v, by: nameOf.get(v.created_by) ?? 'Admin' })),
        })
    } catch (e) { return rateErrorResponse(e) }
}

// PUT { bank, stamp, packages, summary, source?, aliases? }  publish the bank's whole list.
export async function PUT(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { bank, stamp, packages, summary, source, aliases } = await request.json().catch(() => ({}))
    if (!bank?.trim() || !stamp) return NextResponse.json({ error: 'Missing bank' }, { status: 400 })
    try {
        const { packages: before } = await loadBank(bank)
        const result = await publishBank({ bank, stamp, packages, before, summary: summary || 'Rates updated', userId: auth.userId, source })
        if (Array.isArray(aliases) && aliases.length) {
            const rows = aliases.map((a: { banker?: string; phrase: string; ladder_key: string }) => ({ bank, banker: a.banker ?? '', phrase: a.phrase, ladder_key: a.ladder_key }))
            const { error } = await createAdminClient().from('rate_aliases').upsert(rows, { onConflict: 'bank,banker,phrase' })
            // The rates are already live; a forgotten answer is only asked again.
            if (error) console.error('[rates] remembering answers failed:', error.message)
        }
        return NextResponse.json(result)
    } catch (e) { return rateErrorResponse(e) }
}

// PATCH { bank, note } saves the bank-wide note; { forgetAlias } removes a saved answer.
export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const { bank, note, forgetAlias } = await request.json().catch(() => ({}))
    const db = createAdminClient()
    if (forgetAlias) {
        const { error } = await db.from('rate_aliases').delete().eq('id', forgetAlias)
        return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ success: true })
    }
    if (!bank?.trim() || typeof note !== 'string') return NextResponse.json({ error: 'Missing bank or note' }, { status: 400 })
    const { error } = note.trim()
        ? await db.from('bank_rate_notes').upsert({ bank, note: note.trim(), updated_at: new Date().toISOString() })
        : await db.from('bank_rate_notes').delete().eq('bank', bank)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    invalidatePackagesCache()
    return NextResponse.json({ success: true })
}
