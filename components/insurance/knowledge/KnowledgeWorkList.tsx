'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleAlert, ClipboardCheck, Search } from 'lucide-react'
import type { KnowledgeArticle } from '@/lib/types/knowledge'
import { officialName } from '@/lib/insurance/officialName'
import Spinner from '@/components/shared/Spinner'
import { askConfirm } from '@/components/shared/ConfirmDialog'

type Mode = 'publish' | 'check'
interface Result { done: number; skipped: { id: string; title: string; why: string }[] }

const PAGE = 50
/** Matches the server's limit per request. */
const MAX = 100
const BTN = 'min-h-11 px-4 rounded-full text-sm font-semibold disabled:opacity-40'

const TEXT: Record<Mode, { intro: string; empty: string; action: (n: number) => string; confirm: (n: number) => { title: string; message: string; confirmLabel: string }; done: (n: number) => string }> = {
    publish: {
        intro: "Agents can't see these yet. Review them one by one, or tick the ones you've checked and publish them together. Drafts from official pages are checked against their page again; any with a figure not on the page are skipped.",
        empty: 'No drafts waiting.',
        action: n => `Publish ${n}`,
        confirm: n => ({
            title: `Publish ${n} draft${n === 1 ? '' : 's'}?`,
            message: `Agents get ${n === 1 ? 'it' : 'them'} straight away, marked as checked by you. Any draft with a figure not on its official page is skipped.`,
            confirmLabel: `Publish ${n}`,
        }),
        done: n => `${n} published.`,
    },
    check: {
        intro: "Agents already get these, but nobody has confirmed them against their source. Review them one by one, or tick the ones you've checked.",
        empty: 'Every live article has been checked.',
        action: n => `Mark ${n} as checked`,
        confirm: n => ({
            title: `Mark ${n} article${n === 1 ? '' : 's'} as checked?`,
            message: "Your name and today's date are saved on each one, so only confirm what you've checked against its source.",
            confirmLabel: `Mark ${n} as checked`,
        }),
        done: n => `${n} marked as checked.`,
    },
}

/** The source chip, badges, checked state and link host under an article's title. */
export function ArticleMeta({ a }: { a: KnowledgeArticle }) {
    const host = a.source ? (URL.canParse(a.source) ? new URL(a.source).hostname.replace(/^www\./, '') : a.source) : null
    return (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-500">
            {a.source_changed_at
                ? <span className="font-semibold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">Page changed: check again</span>
                : a.status === 'draft' && <span className="font-semibold rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">Draft</span>}
            {a.official_page_id && <span className="font-semibold rounded-full bg-sky-50 text-sky-800 px-2 py-0.5">From {officialName(a.source) ?? 'official'} page</span>}
            {a.checked_on
                ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} /> Checked {a.checked_on}</span>
                : <span className="inline-flex items-center gap-1 text-amber-700"><CircleAlert size={13} /> Not checked</span>}
            <span className="truncate max-w-56">{host ?? 'No source'}</span>
        </span>
    )
}

/** A work queue with tick boxes: drafts to publish, or live articles to mark as checked. */
export default function KnowledgeWorkList({ mode, articles, onOpen, onDone }: {
    mode: Mode
    articles: KnowledgeArticle[]
    /** Opens the review screen at `a`, then carries on through `queue`. */
    onOpen: (a: KnowledgeArticle, queue: KnowledgeArticle[]) => void
    onDone: () => Promise<void>
}) {
    const t = TEXT[mode]
    const [origin, setOrigin] = useState('all')
    const [search, setSearch] = useState('')
    const [shown, setShown] = useState(PAGE)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [busy, setBusy] = useState(false)
    const [result, setResult] = useState<Result | { error: string } | null>(null)

    const originOf = (a: KnowledgeArticle) => officialName(a.source) ?? 'TLC'
    const origins = ['all', ...[...new Set(articles.map(originOf))].sort((a, b) => (a === 'TLC' ? 1 : b === 'TLC' ? -1 : a.localeCompare(b)))]
    const needle = search.trim().toLowerCase()
    const list = articles.filter(a => (origin === 'all' || originOf(a) === origin)
        && (!needle || [a.title, a.content, ...a.tags].some(x => x.toLowerCase().includes(needle))))
    const visible = list.slice(0, shown)
    // Only what's on screen can be selected, so nothing hidden by a filter is published by accident.
    const picked = visible.filter(a => selected.has(a.id))
    const allPicked = visible.length > 0 && visible.slice(0, MAX).every(a => selected.has(a.id))

    const toggle = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
    const toggleAll = () => setSelected(allPicked ? new Set() : new Set(visible.slice(0, MAX).map(a => a.id)))
    const filterTo = (f: () => void) => { f(); setSelected(new Set()); setShown(PAGE) }

    const run = async () => {
        const ids = picked.slice(0, MAX).map(a => a.id)
        if (!ids.length || !(await askConfirm({ ...t.confirm(ids.length), tone: 'primary' }))) return
        setBusy(true)
        setResult(null)
        try {
            const res = await fetch('/api/admin/knowledge/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: mode, ids }) })
            const json = await res.json().catch(() => null)
            setResult(res.ok && json ? json : { error: json?.error ?? 'Something went wrong. Please try again.' })
        } catch { setResult({ error: 'Something went wrong. Please try again.' }) }
        setSelected(new Set())
        await onDone()
        setBusy(false)
    }

    return (
        <div className="space-y-4 pb-24">
            <p className="text-sm text-slate-600">{t.intro}</p>

            {result && ('error' in result ? (
                <p className="text-sm rounded-xl px-4 py-3 bg-red-50 text-red-700 flex gap-2"><AlertTriangle size={17} className="shrink-0 mt-0.5" />{result.error}</p>
            ) : (
                <div className={`text-sm rounded-xl px-4 py-3 space-y-2 ${result.skipped.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
                    <p className="font-semibold flex gap-2"><CheckCircle2 size={17} className="shrink-0 mt-0.5" />{t.done(result.done)}{result.skipped.length > 0 && ` ${result.skipped.length} skipped:`}</p>
                    {result.skipped.length > 0 && (
                        <ul className="space-y-1 pl-6">
                            {result.skipped.map(s => {
                                const a = articles.find(x => x.id === s.id)
                                return (
                                    <li key={s.id}>
                                        {a ? <button onClick={() => onOpen(a, [a])} className="font-semibold underline text-left">{s.title}</button> : <b>{s.title}</b>}: {s.why}
                                    </li>
                                )
                            })}
                        </ul>
                    )}
                </div>
            ))}

            {articles.length === 0 ? (
                <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 size={18} className="text-emerald-600" /> {t.empty}</p>
            ) : (
                <>
                    <div className="flex flex-wrap gap-2">
                        <div className="flex-1 min-w-56 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-[#03a9e7]">
                            <Search size={16} className="text-slate-400 shrink-0" />
                            <input value={search} onChange={e => filterTo(() => setSearch(e.target.value))} aria-label="Search" placeholder="Search" className="flex-1 min-w-0 min-h-11 text-base sm:text-sm bg-transparent outline-none" />
                        </div>
                        <button disabled={!list.length} onClick={() => onOpen(list[0], list)} className={`${BTN} bg-[#052d4a] text-white hover:bg-[#0a3d62] inline-flex items-center gap-2`}>
                            <ClipboardCheck size={16} /> Review one by one{list.length !== articles.length && ` (${list.length})`}
                        </button>
                    </div>
                    {origins.length > 2 && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Source</span>
                            {origins.map(o => (
                                <button key={o} aria-pressed={origin === o} onClick={() => filterTo(() => setOrigin(o))}
                                    className={`min-h-11 px-3.5 rounded-full border text-sm font-medium ${origin === o ? 'bg-[#0369a1] border-[#0369a1] text-white' : 'bg-white border-slate-200 text-slate-600'}`}>
                                    {o === 'all' ? 'All' : o} <span className="tabular-nums opacity-70">{o === 'all' ? articles.length : articles.filter(a => originOf(a) === o).length}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                        <li className="flex items-center gap-1 bg-slate-50 pr-4">
                            <label className="w-14 min-h-12 grid place-items-center cursor-pointer">
                                <input type="checkbox" checked={allPicked} onChange={toggleAll} aria-label="Select all shown" className="w-5 h-5 accent-[#052d4a]" />
                            </label>
                            <p className="text-sm text-slate-600">{allPicked ? `All ${Math.min(visible.length, MAX)} shown selected` : `Select all ${Math.min(visible.length, MAX)} shown`}{list.length !== articles.length && <span className="text-slate-400"> (filtered)</span>}</p>
                        </li>
                        {visible.map(a => (
                            <li key={a.id} className={`flex items-start gap-1 ${selected.has(a.id) ? 'bg-sky-50/70' : 'hover:bg-slate-50'}`}>
                                <label className="w-14 min-h-[72px] shrink-0 grid place-items-center cursor-pointer">
                                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Select ${a.title}`} className="w-5 h-5 accent-[#052d4a]" />
                                </label>
                                <button onClick={() => { const k = list.indexOf(a); onOpen(a, [...list.slice(k), ...list.slice(0, k)]) }} className="flex-1 min-w-0 text-left pr-4 py-3.5">
                                    <span className="block text-[15px] font-semibold text-[#052d4a]">{a.title}</span>
                                    <span className="text-sm text-slate-600 line-clamp-2 mt-0.5">{a.content}</span>
                                    <ArticleMeta a={a} />
                                </button>
                            </li>
                        ))}
                    </ul>
                    {list.length > shown && <button onClick={() => setShown(s => s + PAGE)} className="btn-ghost w-full min-h-11 text-sm">Load more ({list.length - shown} remaining)</button>}
                </>
            )}

            {picked.length > 0 && (
                <div className="fixed bottom-4 inset-x-4 z-40 flex justify-center pointer-events-none">
                    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-[#052d4a] text-white shadow-2xl pl-5 pr-2 py-2">
                        <p className="text-sm font-semibold">{picked.length} selected{picked.length > MAX && ` (first ${MAX} at a time)`}</p>
                        <button onClick={() => setSelected(new Set())} disabled={busy} className={`${BTN} text-white/80 hover:bg-white/10`}>Clear</button>
                        <button onClick={run} disabled={busy} className={`${BTN} bg-emerald-500 text-white hover:bg-emerald-600 inline-flex items-center gap-2`}>
                            {busy ? <Spinner size="sm" color="white" label={mode === 'publish' ? 'Publishing…' : 'Saving…'} /> : <><CheckCircle2 size={16} /> {t.action(Math.min(picked.length, MAX))}</>}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
