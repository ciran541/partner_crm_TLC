'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, ClipboardCheck, ExternalLink, Hand, Landmark, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import type { OfficialPage, OfficialSite } from '@/lib/insurance/officialSources'
import type { KnowledgeArticle } from '@/lib/types/knowledge'
import Spinner from '@/components/shared/Spinner'
import DraftReview from '@/components/insurance/knowledge/DraftReview'
import { suggestDays } from '@/lib/insurance/officialEvidence'
import { calculatorsForPage } from '@/lib/insurance/calculatorGuide'
import { runCalc, type CalcKind } from '@/lib/insurance/knowledgeCalc'
import { askConfirm } from '@/components/shared/ConfirmDialog'

type Page = OfficialPage & { articles: { live: number; drafts: number; recheck: number } }
interface Data { sites: OfficialSite[]; pages: Page[] }
type Alert = { type: 'success' | 'error'; message: string }

const BTN = 'min-h-11 px-4 rounded-full text-sm font-semibold disabled:opacity-40'
const OUTLINE = `${BTN} border border-slate-200 bg-white text-slate-700 hover:border-slate-300`
const PRIMARY = `${BTN} bg-[#052d4a] text-white hover:bg-[#0a3d62]`
const INPUT = 'w-full min-h-11 px-3 text-base sm:text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]'
const FREQ = [{ days: 1, label: 'Daily' }, { days: 7, label: 'Weekly' }, { days: 30, label: 'Monthly' }]
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

async function call(body: Record<string, unknown>) {
    const res = await fetch('/api/admin/knowledge/official', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = await res?.json().catch(() => null)
    if (!res?.ok) throw new Error(json?.error ?? 'Something went wrong. Please try again.')
    return json
}

/** What a check found, in words. */
function outcome(r: { outcome: string; drafts?: number; dropped?: number; error?: string }): Alert {
    const drafts = r.drafts ? ` ${r.drafts} draft${r.drafts === 1 ? '' : 's'} written: tap Review drafts.` : ''
    const dropped = r.dropped ? ` ${r.dropped} left out (figure not on the page, or already in HUB).` : ''
    if (r.outcome === 'failed' || r.outcome === 'blocked') return { type: 'error', message: r.error ?? "Couldn't read the page." }
    if (r.error) return { type: 'error', message: r.error }
    if (r.outcome === 'changed') return { type: 'error', message: `The page has changed. Its articles are hidden from agents until checked again.${drafts}` }
    return { type: 'success', message: (r.outcome === 'first' ? 'Page read.' : 'No change on the page.') + drafts + dropped }
}

/** Admin: the government websites and pages HUB reads to draft Knowledge answers. */
export default function OfficialSources({ articles, onChanged, onOpenCalculator }: { articles: KnowledgeArticle[]; onChanged: () => void; onOpenCalculator: (k: CalcKind) => void }) {
    const [data, setData] = useState<Data | null>(null)
    const [failed, setFailed] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [alert, setAlert] = useState<Alert | null>(null)
    const [adding, setAdding] = useState<'page' | 'site' | null>(null)
    const [siteId, setSiteId] = useState<string>('all')
    const [review, setReview] = useState<KnowledgeArticle[] | null>(null)
    const [progress, setProgress] = useState<string | null>(null)

    const load = async () => {
        try {
            const res = await fetch('/api/admin/knowledge/official')
            if (!res.ok) throw new Error()
            setData(await res.json())
            setFailed(false)
        } catch { setFailed(true) }
    }
    useEffect(() => { load() }, [])

    const run = async (key: string, body: Record<string, unknown>, done?: (json: { result?: Parameters<typeof outcome>[0] }) => Alert | null) => {
        setBusy(key)
        setAlert(null)
        try {
            const json = await call(body)
            const a = done?.(json) ?? null
            if (a) setAlert(a)
            if (json.result?.drafts) onChanged()
            await load()
            setBusy(null)
            return true
        } catch (e) { setAlert({ type: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' }) }
        setBusy(null)
        return false
    }

    if (failed) return <EmptyState icon={CircleAlert} iconColor="#dc2626" title="Couldn't load official pages" description="Check the connection and try again." action={{ label: 'Try again', onClick: load }} />
    if (!data) return <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} height={80} radius={14} />)}</div>

    const siteOf = (pageId: string | null | undefined) => data.sites.find(s => s.id === data.pages.find(p => p.id === pageId)?.site_id)
    const inScope = (pageId: string | null | undefined) => siteId === 'all' || siteOf(pageId)?.id === siteId
    // Changed pages' articles first: agents can't see those right now.
    const toReview = articles.filter(a => a.official_page_id && a.status === 'draft')
        .sort((a, b) => Number(!!b.source_changed_at) - Number(!!a.source_changed_at))
    const sections = Object.fromEntries(data.pages.map(p => [p.id, `${siteOf(p.id)?.name ?? ''} · ${p.section || p.title || 'Page'}`]))
    const scopedReview = toReview.filter(a => inScope(a.official_page_id))
    const pages = data.pages.filter(p => inScope(p.id))
    const readable = (p: Page) => !!data.sites.find(s => s.id === p.site_id)?.bots_allowed
    const unread = pages.filter(p => p.status === 'new' && readable(p))
    const attention = pages.filter(p => ['changed', 'failed', 'blocked'].includes(p.status) && readable(p))
    const sites = data.sites.filter(s => siteId === 'all' || s.id === siteId)

    // One page per request: each read stays inside the server's time limit.
    const readAll = async () => {
        let drafts = 0, failedReads = 0
        setBusy('readAll')
        setAlert(null)
        for (const [k, p] of unread.entries()) {
            setProgress(`Reading ${k + 1} of ${unread.length}: ${p.section || p.title}`)
            try {
                const r = (await call({ action: 'check', id: p.id })).result
                drafts += r?.drafts ?? 0
                if (r?.outcome === 'failed' || r?.outcome === 'blocked') failedReads++
            } catch { failedReads++ }
        }
        setProgress(null)
        setBusy(null)
        const ok = unread.length - failedReads
        setAlert({ type: failedReads ? 'error' : 'success', message: `${ok} page${ok === 1 ? '' : 's'} read, ${drafts} draft${drafts === 1 ? '' : 's'} written.${failedReads ? ` ${failedReads} couldn't be read: see the page for why.` : ''}` })
        onChanged()
        await load()
    }

    return (
        <div className="space-y-5">
            <p className="text-sm text-slate-600">
                HUB reads these government pages, drafts short answers in TLC&apos;s own words, and tells you when a page changes.
                Agents only see an answer after an admin checks it against the page.
            </p>

            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filter by website">
                {[{ id: 'all', name: 'All websites' }, ...data.sites].map(s => {
                    const n = s.id === 'all' ? toReview.length : toReview.filter(a => siteOf(a.official_page_id)?.id === s.id).length
                    return (
                        <button key={s.id} role="tab" aria-selected={siteId === s.id} onClick={() => setSiteId(s.id)}
                            className={`min-h-11 px-4 rounded-full border text-sm font-semibold inline-flex items-center gap-2 ${siteId === s.id ? 'bg-[#052d4a] border-[#052d4a] text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
                            {s.name}
                            {n > 0 && <span className={`text-xs rounded-full px-1.5 tabular-nums ${siteId === s.id ? 'bg-white/20' : 'bg-amber-50 text-amber-800'}`}>{n}</span>}
                        </button>
                    )
                })}
                <button onClick={() => setAdding(adding === 'site' ? null : 'site')} className={`${BTN} text-[#0369a1] inline-flex items-center gap-1.5`}><Landmark size={15} /> Add website</button>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
                <div className={`rounded-2xl border p-4 flex flex-col gap-3 ${scopedReview.length ? 'border-sky-200 bg-sky-50/60' : 'border-slate-200 bg-white'}`}>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Drafts to review</p>
                        <p className="text-3xl font-extrabold text-[#052d4a] tabular-nums">{scopedReview.length}</p>
                        {scopedReview.some(a => a.source_changed_at) && <p className="text-xs text-amber-700">{scopedReview.filter(a => a.source_changed_at).length} from changed pages, hidden from agents until checked</p>}
                    </div>
                    <button disabled={!scopedReview.length} onClick={() => setReview(scopedReview)} className={`${PRIMARY} mt-auto inline-flex items-center justify-center gap-2`}><ClipboardCheck size={16} /> Review drafts</button>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pages watched</p>
                        <p className="text-3xl font-extrabold text-[#052d4a] tabular-nums">{pages.length}</p>
                        <p className="text-xs text-slate-500">{unread.length ? `${unread.length} not read yet` : 'All read'}</p>
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2">
                        <button onClick={() => setAdding(adding === 'page' ? null : 'page')} className={`${OUTLINE} inline-flex items-center gap-1.5`}><Plus size={15} /> Add pages</button>
                        {unread.length > 0 && <button disabled={!!progress || !!busy} onClick={readAll} className={OUTLINE}>Read all {unread.length}</button>}
                    </div>
                </div>
                <div className={`rounded-2xl border p-4 ${attention.length ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Needs attention</p>
                    <p className="text-3xl font-extrabold text-[#052d4a] tabular-nums">{attention.length}</p>
                    <p className="text-xs text-slate-500">{attention.length ? 'Pages that changed or couldn’t be read. See below.' : 'Every page is up to date.'}</p>
                </div>
            </div>

            {progress && <p className="text-sm rounded-xl px-4 py-3 bg-sky-50 text-sky-900 flex items-center gap-2"><Spinner size="sm" /> {progress}</p>}
            {alert && (
                <p className={`text-sm rounded-xl px-4 py-3 flex gap-2 ${alert.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
                    {alert.type === 'success' ? <CheckCircle2 size={17} className="shrink-0 mt-0.5" /> : <AlertTriangle size={17} className="shrink-0 mt-0.5" />}
                    {alert.message}
                </p>
            )}

            {adding === 'page' && <AddPage sites={data.sites} initialSite={siteId === 'all' ? null : siteId} busy={!!busy} onCancel={() => setAdding(null)}
                onAdd={body => run('add', { action: 'addPage', ...body }, () => ({ type: 'success', message: `Added "${body.section}". Tap Read all, or HUB reads it tonight.` }))} />}
            {adding === 'site' && <AddSite onCancel={() => setAdding(null)} onAdd={async body => { if (await run('site', { action: 'addSite', ...body }, () => ({ type: 'success', message: 'Website added. Now add its pages.' }))) setAdding(null) }} />}

            {sites.map(site => {
                const own = pages.filter(p => p.site_id === site.id)
                return (
                    <section key={site.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-b border-slate-100">
                            <div className="min-w-0">
                                <p className="text-[15px] font-bold text-[#052d4a]">{site.name} <span className="font-normal text-sm text-slate-500">{site.domain}</span></p>
                                {site.note && <p className="text-xs text-slate-500">{site.note}</p>}
                            </div>
                            <div className="flex items-center gap-1">
                                <button disabled={!!busy} onClick={() => run(`s${site.id}`, { action: 'updateSite', id: site.id, bots_allowed: !site.bots_allowed })}
                                    className={`${BTN} inline-flex items-center gap-1.5 ${site.bots_allowed ? 'bg-sky-50 text-sky-800' : 'bg-violet-50 text-violet-800'}`}
                                    title={site.bots_allowed ? 'Switch to reading by hand' : 'Let HUB read this site'}>
                                    {site.bots_allowed ? <><RefreshCw size={14} /> HUB reads it</> : <><Hand size={14} /> Read by hand</>}
                                </button>
                                <button disabled={!!busy} aria-label={`Remove ${site.name}`} onClick={async () => { if (await askConfirm({ title: `Remove ${site.name} and its pages?`, message: 'HUB stops reading them. Articles already written stay.', confirmLabel: 'Remove', tone: 'danger' })) run(`s${site.id}`, { action: 'deleteSite', id: site.id }) }}
                                    className="w-11 h-11 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
                            </div>
                        </div>
                        {own.length === 0 ? (
                            <p className="px-4 py-4 text-sm text-slate-500">{site.bots_allowed ? 'No pages yet. Tap Add pages to find some.' : `HUB doesn't read ${site.name}. Write its articles from the site by hand, with the page as the source.`}</p>
                        ) : (
                            <ul className="divide-y divide-slate-100">
                                {own.map(p => <PageRow key={p.id} p={p} readable={site.bots_allowed} busy={busy} run={run} onOpenCalculator={onOpenCalculator}
                                    onReview={() => setReview(toReview.filter(a => a.official_page_id === p.id))} />)}
                            </ul>
                        )}
                    </section>
                )
            })}

            {review && <DraftReview drafts={review} sections={sections} onChanged={() => { onChanged(); load() }} onClose={() => setReview(null)} />}
        </div>
    )
}

function Status({ p }: { p: Page }) {
    const chip = 'text-xs font-semibold rounded-full px-2 py-0.5'
    if (p.status === 'changed') return <span className={`${chip} bg-amber-100 text-amber-800`}>Page changed {date(p.changed_at)}</span>
    if (p.status === 'failed') return <span className={`${chip} bg-red-50 text-red-700`}>Couldn&apos;t read</span>
    if (p.status === 'blocked') return <span className={`${chip} bg-red-50 text-red-700`}>Not allowed</span>
    if (p.status === 'new') return <span className={`${chip} bg-slate-100 text-slate-600`}>Not read yet</span>
    return <span className={`${chip} bg-emerald-50 text-emerald-700`}>Checked {date(p.checked_at)}</span>
}

function PageRow({ p, readable, busy, run, onReview, onOpenCalculator }: {
    p: Page; readable: boolean; busy: string | null; onReview: () => void; onOpenCalculator: (k: CalcKind) => void
    run: (key: string, body: Record<string, unknown>, done?: (json: { result?: Parameters<typeof outcome>[0] }) => Alert | null) => Promise<boolean>
}) {
    const a = p.articles
    const mine = busy === p.id
    return (
        <li className="px-4 py-3.5 space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 basis-64">
                    <p className="text-[15px] font-semibold text-[#052d4a]">{p.section || p.title || 'Untitled page'}</p>
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#0369a1] inline-flex items-center gap-1 break-all">{p.title ?? p.url} <ExternalLink size={11} /></a>
                </div>
                <Status p={p} />
            </div>
            <p className="text-sm text-slate-600">
                {a.live} live on HUB{a.drafts > 0 && <> · <b className="text-sky-800">{a.drafts} draft{a.drafts === 1 ? '' : 's'} to review</b></>}
                {a.recheck > 0 && <b className="text-amber-700"> · {a.recheck} to check again</b>}
            </p>
            {p.error && p.status !== 'ok' && <p className="text-sm text-red-600">{p.error}</p>}
            {p.status === 'changed' && (
                <p className="text-sm text-amber-800">Agents don&apos;t see this page&apos;s answers until they&apos;re checked again. Tap <b>Review</b>.</p>
            )}
            {p.status === 'changed' && calculatorsForPage(p.url, p.section).length > 0 && (
                <p className="text-sm text-amber-800">
                    HUB&apos;s calculators also use this page&apos;s rules. Check{' '}
                    {calculatorsForPage(p.url, p.section).map((k, i, all) => (
                        <span key={k}><button onClick={() => onOpenCalculator(k)} className="font-semibold underline min-h-11">{runCalc(k, '').title}</button>{i < all.length - 1 ? ', ' : ''}</span>
                    ))}
                    {' '}and tell the developer if a rate changed.
                </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
                {a.drafts + a.recheck > 0 && <button disabled={!!busy} onClick={onReview} className={`${PRIMARY} inline-flex items-center gap-1.5`}><ClipboardCheck size={15} /> Review {a.drafts + a.recheck}</button>}
                <select aria-label="How often HUB checks this page" value={p.check_days} disabled={!!busy}
                    onChange={e => run(p.id, { action: 'updatePage', id: p.id, check_days: Number(e.target.value) })}
                    className="min-h-11 px-3 rounded-full border border-slate-200 bg-white text-sm text-slate-700">
                    {[...FREQ, ...(FREQ.some(f => f.days === p.check_days) ? [] : [{ days: p.check_days, label: `Every ${p.check_days} days` }])].map(f => <option key={f.days} value={f.days}>{f.label}</option>)}
                </select>
                {readable && (
                    <button disabled={!!busy} onClick={() => run(p.id, { action: 'check', id: p.id, drafts: false }, j => (j.result ? outcome(j.result) : null))} className={OUTLINE}>
                        {mine ? 'Reading…' : p.status === 'new' ? 'Read now' : 'Check now'}
                    </button>
                )}
                {readable && p.status !== 'new' && (
                    <button disabled={!!busy} onClick={() => run(p.id, { action: 'check', id: p.id, drafts: true }, j => (j.result ? outcome(j.result) : null))} className={OUTLINE}>Write drafts again</button>
                )}
                {p.status === 'changed' && a.recheck === 0 && (
                    <button disabled={!!busy} onClick={() => run(p.id, { action: 'reviewed', id: p.id }, () => ({ type: 'success', message: 'Marked as checked.' }))} className={OUTLINE}>Nothing to change</button>
                )}
                <button disabled={!!busy} aria-label="Remove page" onClick={async () => { if (await askConfirm({ title: 'Stop watching this page?', message: 'HUB stops checking it for changes. Its articles stay.', confirmLabel: 'Stop watching', tone: 'danger' })) run(p.id, { action: 'deletePage', id: p.id }) }}
                    className="w-11 h-11 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 ml-auto"><Trash2 size={16} /></button>
            </div>
        </li>
    )
}

function AddPage({ sites, initialSite, busy, onAdd, onCancel }: {
    sites: OfficialSite[]; initialSite: string | null; busy: boolean
    onAdd: (b: { url: string; section: string; check_days: number }) => Promise<boolean>; onCancel: () => void
}) {
    const readable = sites.filter(s => s.bots_allowed)
    const [siteId, setSiteId] = useState(readable.find(s => s.id === initialSite)?.id ?? readable[0]?.id ?? '')
    const [q, setQ] = useState('')
    const [found, setFound] = useState<{ url: string; title: string; days: number }[] | null>(null)
    const [searching, setSearching] = useState(false)
    const [added, setAdded] = useState<Set<string>>(new Set())
    const [url, setUrl] = useState('')
    const [section, setSection] = useState('')
    const [preview, setPreview] = useState<{ ok: boolean; title?: string; sample?: string; error?: string } | null>(null)
    const [testing, setTesting] = useState(false)
    const site = sites.find(s => s.id === siteId)

    const search = async () => {
        setSearching(true)
        try { setFound((await call({ action: 'findPages', id: siteId, q })).pages) } catch { setFound([]) }
        setSearching(false)
    }
    const add = async (p: { url: string; title: string; days: number }) => {
        if (await onAdd({ url: p.url, section: p.title, check_days: p.days })) setAdded(prev => new Set(prev).add(p.url))
    }
    const test = async () => {
        setTesting(true)
        try { setPreview(await call({ action: 'preview', url: url.trim() })) } catch (e) { setPreview({ ok: false, error: e instanceof Error ? e.message : 'Test failed.' }) }
        setTesting(false)
    }

    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
                <p className="text-[15px] font-bold text-[#052d4a]">Add pages</p>
                <button onClick={onCancel} className={`${BTN} text-slate-500`}>Close</button>
            </div>
            {readable.length === 0 ? <p className="text-sm text-slate-500">No website is set for HUB to read. Add one first.</p> : (
                <>
                    <div className="flex flex-wrap gap-2">
                        <select aria-label="Website" value={siteId} onChange={e => { setSiteId(e.target.value); setFound(null) }} className="min-h-11 px-3 rounded-lg border border-slate-200 bg-white text-base sm:text-sm">
                            {readable.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <div className="flex-1 min-w-56 flex items-center gap-2 rounded-lg border border-slate-200 px-3 focus-within:border-[#03a9e7]">
                            <Search size={16} className="text-slate-400 shrink-0" />
                            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search() }}
                                placeholder={`Search ${site?.name ?? ''} pages, e.g. resale loan`} aria-label="Search pages" className="flex-1 min-w-0 min-h-11 text-base sm:text-sm outline-none bg-transparent" />
                        </div>
                        <button onClick={search} disabled={searching || !siteId} className={PRIMARY}>{searching ? 'Searching…' : 'Search'}</button>
                    </div>
                    {found && (found.length === 0 ? (
                        <p className="text-sm text-slate-500">No pages found. Try fewer or different words, or paste a link below.</p>
                    ) : (
                        <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-96 overflow-y-auto">
                            {found.map(p => (
                                <li key={p.url} className="flex items-center gap-3 px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-semibold text-slate-800">{p.title}</p>
                                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500 break-all">{p.url.replace(/^https:\/\/(www\.)?/, '')}</a>
                                    </div>
                                    <span className="text-xs text-slate-500 hidden sm:block">{p.days === 7 ? 'Weekly' : 'Monthly'}</span>
                                    {added.has(p.url)
                                        ? <span className="min-h-11 px-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700"><CheckCircle2 size={15} /> Added</span>
                                        : <button disabled={busy} onClick={() => add(p)} className={OUTLINE}>Add</button>}
                                </li>
                            ))}
                        </ul>
                    ))}
                    <p className="text-xs text-slate-500">Pages about stamp duty, TDSR, MSR and LTV are checked weekly, the rest monthly. You can change it on each page.</p>
                </>
            )}

            <details className="rounded-xl bg-slate-50 px-3 py-1">
                <summary className="min-h-11 flex items-center text-sm font-semibold text-slate-700 cursor-pointer">Or paste a link</summary>
                <div className="space-y-3 pb-3">
                    <input value={url} onChange={e => { setUrl(e.target.value); setPreview(null) }} placeholder="https://www.iras.gov.sg/…" aria-label="Page link" className={INPUT} />
                    <input value={section} onChange={e => setSection(e.target.value)} placeholder="Topic, e.g. Stamp duty: ABSD" aria-label="Topic" className={INPUT} />
                    {preview && (preview.ok ? (
                        <div className="rounded-lg bg-white p-3 text-sm space-y-1">
                            <p className="font-semibold text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={15} /> HUB can read this page: {preview.title}</p>
                            <p className="text-xs text-slate-700 whitespace-pre-line max-h-40 overflow-y-auto">{preview.sample}</p>
                        </div>
                    ) : <p className="text-sm text-red-600">{preview.error}</p>)}
                    <div className="flex flex-wrap gap-2">
                        <button onClick={test} disabled={testing || !url.trim()} className={OUTLINE}>{testing ? 'Testing…' : 'Test this page'}</button>
                        <button disabled={busy || !url.trim() || !section.trim()}
                            onClick={async () => { if (await onAdd({ url: url.trim(), section: section.trim(), check_days: suggestDays(section) })) { setUrl(''); setSection(''); setPreview(null) } }}
                            className={PRIMARY}>Add page</button>
                    </div>
                </div>
            </details>
        </div>
    )
}

function AddSite({ onAdd, onCancel }: { onAdd: (b: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
    const [domain, setDomain] = useState('')
    const [name, setName] = useState('')
    const [bots, setBots] = useState(true)
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
                <label className="block text-sm font-semibold text-slate-700">Website
                    <input value={domain} onChange={e => setDomain(e.target.value)} placeholder="ura.gov.sg" className={`${INPUT} mt-1 font-normal`} />
                </label>
                <label className="block text-sm font-semibold text-slate-700">Short name
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="URA" className={`${INPUT} mt-1 font-normal`} />
                </label>
            </div>
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
                <input type="checkbox" checked={!bots} onChange={e => setBots(!e.target.checked)} className="mt-1" />
                <span>Read by hand only <span className="block text-xs text-slate-500">Tick when the site&apos;s terms don&apos;t allow automated reading (like CPF).</span></span>
            </label>
            <div className="flex flex-wrap gap-2">
                <button disabled={!domain.trim() || !name.trim()} onClick={() => onAdd({ domain, name, bots_allowed: bots })} className={PRIMARY}>Add website</button>
                <button onClick={onCancel} className={`${BTN} text-slate-500`}>Cancel</button>
            </div>
        </div>
    )
}
