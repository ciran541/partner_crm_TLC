import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkPageNow, draftEvidence, findPages, readPage, siteFor, type OfficialSite } from '@/lib/insurance/officialSources'

// Reading a page and writing its drafts can take a while.
export const maxDuration = 60

/** "https://www.IRAS.gov.sg/x" → "iras.gov.sg"; null when it isn't a domain. */
function cleanDomain(v: unknown): string | null {
    if (typeof v !== 'string') return null
    const d = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '')
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : null
}
const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const days = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 365 ? (v as number) : null)
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

// GET /api/admin/knowledge/official — approved sites, their pages, and each page's articles by state.
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const db = createAdminClient()
    const [sites, pages, articles] = await Promise.all([
        db.from('official_sites').select('*').order('name'),
        db.from('official_pages').select('*').order('section'),
        db.from('knowledge_articles').select('official_page_id, status, source_changed_at').not('official_page_id', 'is', null),
    ])
    const err = sites.error ?? pages.error ?? articles.error
    if (err) return bad(err.message, 500)
    const counts: Record<string, { live: number; drafts: number; recheck: number }> = {}
    for (const a of articles.data ?? []) {
        const c = (counts[a.official_page_id] ??= { live: 0, drafts: 0, recheck: 0 })
        if (a.source_changed_at) c.recheck++
        else if (a.status === 'published') c.live++
        else c.drafts++
    }
    return NextResponse.json({
        sites: sites.data,
        pages: (pages.data ?? []).map(p => ({ ...p, articles: counts[p.id] ?? { live: 0, drafts: 0, recheck: 0 } })),
    })
}

// POST /api/admin/knowledge/official — { action, ... }
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const db = createAdminClient()
    const b = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!b || typeof b.action !== 'string') return bad('Missing action')
    const id = typeof b.id === 'string' ? b.id : ''

    switch (b.action) {
        case 'addSite': {
            const domain = cleanDomain(b.domain)
            const name = text(b.name, 60)
            if (!domain || !name) return bad('Enter the website (e.g. ura.gov.sg) and a short name.')
            const { error } = await db.from('official_sites').insert({ domain, name, bots_allowed: b.bots_allowed !== false, note: text(b.note, 300) || null })
            if (error) return bad(error.code === '23505' ? 'That website is already on the list.' : error.message, error.code === '23505' ? 409 : 500)
            return NextResponse.json({ ok: true })
        }
        case 'updateSite': {
            const patch: Record<string, unknown> = {}
            if (typeof b.bots_allowed === 'boolean') patch.bots_allowed = b.bots_allowed
            if (text(b.name, 60)) patch.name = text(b.name, 60)
            if (typeof b.note === 'string') patch.note = text(b.note, 300) || null
            const { error } = await db.from('official_sites').update(patch).eq('id', id)
            return error ? bad(error.message, 500) : NextResponse.json({ ok: true })
        }
        case 'deleteSite': {
            // Articles stay; they just lose the link to their page.
            const { error } = await db.from('official_sites').delete().eq('id', id)
            return error ? bad(error.message, 500) : NextResponse.json({ ok: true })
        }
        case 'preview':
        case 'addPage': {
            const url = text(b.url, 1000)
            const { data: sites } = await db.from('official_sites').select('*')
            const site = siteFor(url, (sites ?? []) as OfficialSite[])
            if (!site) return bad('Only pages of an approved website can be added. Add the website first.')
            if (b.action === 'preview') {
                if (!site.bots_allowed) return NextResponse.json({ ok: false, error: `${site.name} is set to be read by hand, so HUB won't read it.` })
                const r = await readPage(url)
                // Admin-only preview of what HUB can read; nothing is stored.
                return NextResponse.json(r.ok ? { ok: true, title: r.title, chars: r.text.length, sample: r.text.slice(0, 1500) } : r)
            }
            const { data, error } = await db.from('official_pages')
                .insert({ site_id: site.id, url, section: text(b.section, 80), check_days: days(b.check_days) ?? 30, created_by: auth.userId })
                .select('id').single()
            if (error) return bad(error.code === '23505' ? 'That page is already on the list.' : error.message, error.code === '23505' ? 409 : 500)
            return NextResponse.json({ ok: true, id: data.id })
        }
        case 'updatePage': {
            const patch: Record<string, unknown> = {}
            if (typeof b.section === 'string') patch.section = text(b.section, 80)
            if (days(b.check_days)) patch.check_days = days(b.check_days)
            const { error } = await db.from('official_pages').update(patch).eq('id', id)
            return error ? bad(error.message, 500) : NextResponse.json({ ok: true })
        }
        case 'deletePage': {
            const { error } = await db.from('official_pages').delete().eq('id', id)
            return error ? bad(error.message, 500) : NextResponse.json({ ok: true })
        }
        case 'check': {
            const r = await checkPageNow(id, b.drafts === true)
            return r ? NextResponse.json({ ok: true, result: r }) : bad('Page not found', 404)
        }
        case 'findPages': {
            const q = text(b.q, 80)
            return NextResponse.json({ pages: await findPages(id, q) })
        }
        case 'evidence': {
            // Read live for the reviewing admin; nothing is stored.
            return NextResponse.json(await draftEvidence(id))
        }
        case 'reviewed': {
            // The change didn't affect any article (or they were handled by hand).
            const { error } = await db.from('official_pages').update({ status: 'ok' }).eq('id', id).eq('status', 'changed')
            return error ? bad(error.message, 500) : NextResponse.json({ ok: true })
        }
        default:
            return bad('Unknown action')
    }
}
