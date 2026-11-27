'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Trash2, X, XCircle } from 'lucide-react'
import type { KnowledgeArticle } from '@/lib/types/knowledge'
import type { Evidence } from '@/lib/insurance/officialEvidence'
import { officialName } from '@/lib/insurance/officialName'
import Spinner from '@/components/shared/Spinner'
import { figureTokens, figureValues } from '@/lib/insurance/figures'
import { askConfirm } from '@/components/shared/ConfirmDialog'

type Proof = { url: string; evidence: Evidence } | { error: string }
const INPUT = 'w-full px-3 py-2.5 text-base sm:text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]'
const BTN = 'min-h-12 px-5 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-40'
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)
const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = await res?.json().catch(() => null)
    if (!res?.ok) throw new Error(json?.error ?? 'Something went wrong. Please try again.')
    return json
}

/** Figures in a line, marked green when they're in the draft too. */
function Marked({ line, figures }: { line: string; figures: string[] }) {
    const want = new Set(figures.map(f => f.replace(/[\s,]/g, '').toLowerCase()))
    const parts = line.split(/(\$?\d[\d,]*(?:\.\d+)?%?)/g)
    return <>{parts.map((p, i) => (i % 2 && want.has(p.replace(/[\s,]/g, '').toLowerCase())
        ? <mark key={i} className="bg-emerald-100 text-emerald-900 rounded px-0.5">{p}</mark>
        : <span key={i}>{p}</span>))}</>
}

/**
 * The one review screen (Knowledge → Review, Official pages): one article at a
 * time. Official-page articles sit beside the page lines holding their figures;
 * TLC's own beside their source. A draft is published, a live one marked checked.
 */
export default function DraftReview({ drafts: initial, sections, onClose, onChanged }: {
    drafts: KnowledgeArticle[]
    /** page id → "HDB · HDB housing loan" */
    sections: Record<string, string>
    onClose: () => void
    onChanged: () => void
}) {
    const [queue, setQueue] = useState(initial)
    const [i, setI] = useState(0)
    const [done, setDone] = useState({ published: 0, checked: 0, deleted: 0 })
    const [proofs, setProofs] = useState<Record<string, Proof>>({})
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const a = queue[Math.min(i, queue.length - 1)]

    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [asks, setAsks] = useState('')
    const [source, setSource] = useState('')
    const official = !!a?.official_page_id
    const live = a?.status === 'published'
    const [asked] = useState(() => new Set<string>())
    const fetchProof = (id: string | undefined) => {
        if (!id || asked.has(id)) return
        asked.add(id)
        post('/api/admin/knowledge/official', { action: 'evidence', id })
            .then(p => setProofs(m => ({ ...m, [id]: p })))
            .catch(e => setProofs(m => ({ ...m, [id]: { error: e.message } })))
    }
    useEffect(() => {
        if (!a) return
        setTitle(a.title); setContent(a.content); setAsks(a.tags.join('\n')); setSource(a.source ?? ''); setError(null)
        if (a.official_page_id) fetchProof(a.id)
        // The next one loads while this one is read, so moving on is instant.
        const next = queue[(queue.indexOf(a) + 1) % queue.length]
        if (next?.official_page_id) fetchProof(next.id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [a?.id])

    const proof = a ? proofs[a.id] : undefined
    const edited = !!a && (title !== a.title || content !== a.content || asks !== a.tags.join('\n') || source !== (a.source ?? ''))
    // Figures re-checked live against the page as the admin edits.
    const figures = useMemo(() => {
        if (!proof || 'error' in proof) return []
        if (!edited) return proof.evidence.figures
        const known = new Set(proof.evidence.pageFigures)
        return figureTokens(content).map(text => ({ text, found: figureValues(text).every(v => known.has(v)) }))
    }, [proof, content, edited])
    const missing = figures.filter(f => !f.found)

    // Never lose typed changes by moving on.
    const leave = async (go: () => void) => { if (!edited || await askConfirm({ title: 'Discard your changes to this draft?', confirmLabel: 'Discard', tone: 'warn' })) go() }
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) leave(onClose) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    const remove = (kind: 'published' | 'checked' | 'deleted') => {
        setQueue(q => q.filter(x => x.id !== a.id))
        setDone(d => ({ ...d, [kind]: d[kind] + 1 }))
        onChanged()
    }
    const approve = async () => {
        setBusy(true); setError(null)
        try {
            await post('/api/admin/knowledge/update', { id: a.id, updates: { title: title.trim(), content: content.trim(), tags: lines(asks), source: official ? a.source ?? null : source.trim() || null, status: 'published', checked: true, gapIds: [] } })
            remove(live ? 'checked' : 'published')
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') }
        setBusy(false)
    }
    const del = async () => {
        const message = live ? 'Agents will stop getting it.' : official ? 'Agents never saw it. HUB writes it again only if you tap "Write drafts again".' : 'Agents never saw it.'
        if (!(await askConfirm({ title: live ? 'Delete this article?' : 'Delete this draft?', message, confirmLabel: 'Delete', tone: 'danger' }))) return
        setBusy(true); setError(null)
        try { await post('/api/admin/knowledge/delete', { id: a.id }); remove('deleted') } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.') }
        setBusy(false)
    }

    return (
        <div className="fixed inset-0 z-[100] bg-[#f1f5f9] flex flex-col">
            <div className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold text-[#052d4a]">Review</p>
                    <p className="text-xs text-slate-500">{queue.length ? `${Math.min(i, queue.length - 1) + 1} of ${queue.length} left` : 'All done'}{summary(done) && ` · ${summary(done)}`}</p>
                </div>
                {queue.length > 1 && (
                    <div className="flex gap-1">
                        <button aria-label="Previous draft" disabled={i === 0 || busy} onClick={() => leave(() => setI(i - 1))} className="w-12 h-12 grid place-items-center rounded-full hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={20} /></button>
                        <button aria-label="Next draft" disabled={i >= queue.length - 1 || busy} onClick={() => leave(() => setI(i + 1))} className="w-12 h-12 grid place-items-center rounded-full hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={20} /></button>
                    </div>
                )}
                <button onClick={() => leave(onClose)} disabled={busy} aria-label="Close" className="w-12 h-12 grid place-items-center rounded-full hover:bg-slate-100 text-slate-500"><X size={20} /></button>
            </div>

            {!a ? (
                <div className="flex-1 grid place-items-center p-6 text-center">
                    <div>
                        <CheckCircle2 size={40} className="text-emerald-600 mx-auto" />
                        <p className="text-lg font-bold text-[#052d4a] mt-3">All reviewed</p>
                        <p className="text-sm text-slate-600 mt-1">{summary(done) || 'Nothing changed'}.{done.published > 0 && ' Agents get the published ones straight away.'}</p>
                        <button onClick={onClose} className={`${BTN} bg-[#052d4a] text-white mt-5`}>Done</button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="flex-1 overflow-y-auto">
                        <div className="max-w-6xl mx-auto p-4 sm:p-6 grid lg:grid-cols-2 gap-5 items-start">
                            {/* The draft */}
                            <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${live ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{live ? 'Live, not checked' : 'Draft, agents can’t see it'}</span>
                                    <span className="text-xs font-bold uppercase tracking-wide text-sky-700">{official ? (a.official_page_id && sections[a.official_page_id]) || `From ${officialName(a.source) ?? 'official'} page` : 'TLC article'}</span>
                                </div>
                                {a.source_changed_at && <p className="text-sm rounded-lg bg-amber-50 text-amber-800 px-3 py-2">The page changed on {a.source_changed_at.slice(0, 10)}. Check this against the new page.</p>}
                                <label className="block text-sm font-semibold text-slate-700">Question
                                    <input value={title} onChange={e => setTitle(e.target.value)} className={`${INPUT} mt-1 font-normal`} />
                                </label>
                                <label className="block text-sm font-semibold text-slate-700">Answer
                                    <textarea value={content} onChange={e => setContent(e.target.value)} rows={6} className={`${INPUT} mt-1 font-normal resize-y`} style={{ fontFamily: 'inherit' }} />
                                </label>
                                <label className="block text-sm font-semibold text-slate-700">Other ways agents ask <span className="font-normal text-slate-400">(one per line)</span>
                                    <textarea value={asks} onChange={e => setAsks(e.target.value)} rows={3} className={`${INPUT} mt-1 font-normal resize-y`} style={{ fontFamily: 'inherit' }} />
                                </label>
                                {!official && (
                                    <label className="block text-sm font-semibold text-slate-700">Source <span className="font-normal text-slate-400">(link or document; agents see this)</span>
                                        <input value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. the bank's guide or a MAS page" className={`${INPUT} mt-1 font-normal`} />
                                    </label>
                                )}
                            </section>

                            {/* What to compare it with */}
                            {!official ? <SourcePanel source={source} /> : (
                            <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 lg:sticky lg:top-0">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-sm font-bold text-[#052d4a]">On the {officialName(a.source) ?? 'official'} page</p>
                                    {a.source && <a href={a.source} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[#0369a1] inline-flex items-center gap-1 min-h-11">Open page <ExternalLink size={14} /></a>}
                                </div>
                                {!proof ? <Spinner size="sm" label="Reading the page…" /> : 'error' in proof ? (
                                    <p className="text-sm text-red-600">{proof.error} Open the page to check by hand.</p>
                                ) : (
                                    <>
                                        <div>
                                            <p className="text-xs font-semibold text-slate-500 mb-1.5">Figures in the answer</p>
                                            {figures.length === 0 ? <p className="text-sm text-slate-500">No figures. Check the wording against the lines below.</p> : (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {figures.map(f => (
                                                        <span key={f.text} className={`text-sm font-semibold rounded-full px-2.5 py-1 inline-flex items-center gap-1 ${f.found ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
                                                            {f.found ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {f.text}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {missing.length > 0 && <p className="text-xs text-red-600 mt-1.5">Not found on the page. Fix the answer before publishing.</p>}
                                        </div>
                                        <div>
                                            <p className="text-xs font-semibold text-slate-500 mb-1.5">Matching lines</p>
                                            {proof.evidence.lines.length === 0 ? <p className="text-sm text-slate-500">No close match found. Open the page to check.</p> : (
                                                <ul className="space-y-2">
                                                    {proof.evidence.lines.map((l, k) => <li key={k} className="text-sm text-slate-700 leading-relaxed border-l-2 border-slate-200 pl-3"><Marked line={l} figures={figures.filter(f => f.found).map(f => f.text)} /></li>)}
                                                </ul>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-500 flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />Pages often show old rates next to current ones. Make sure the answer uses the current rule.</p>
                                    </>
                                )}
                            </section>
                            )}
                        </div>
                    </div>

                    <div className="bg-white border-t border-slate-200 px-4 sm:px-6 py-3">
                        <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2">
                            <button onClick={del} disabled={busy} className={`${BTN} text-red-600 hover:bg-red-50`}><Trash2 size={16} /> Delete</button>
                            {error && <p className="text-sm text-red-600 flex-1 min-w-40">{error}</p>}
                            <div className="ml-auto flex gap-2">
                                {queue.length > 1 && <button onClick={() => leave(() => setI((i + 1) % queue.length))} disabled={busy} className={`${BTN} border border-slate-200 bg-white text-slate-700`}>Skip</button>}
                                <button onClick={approve} disabled={busy || !title.trim() || !content.trim() || missing.length > 0}
                                    className={`${BTN} bg-emerald-600 text-white hover:bg-emerald-700`}>
                                    {busy ? <Spinner size="sm" color="white" label="Saving…" /> : <><CheckCircle2 size={16} /> {live ? 'Correct: mark checked' : 'Correct: publish'}</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

const summary = (d: { published: number; checked: number; deleted: number }) =>
    [d.published && `${d.published} published`, d.checked && `${d.checked} marked checked`, d.deleted && `${d.deleted} deleted`].filter(Boolean).join(' · ')

/** TLC's own articles have no official page to read, so the admin compares with the source themselves. */
function SourcePanel({ source }: { source: string }) {
    const link = URL.canParse(source) && /^https?:/.test(source) ? source : null
    return (
        <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 lg:sticky lg:top-0">
            <p className="text-sm font-bold text-[#052d4a]">Check against its source</p>
            {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[#0369a1] inline-flex items-center gap-1 min-h-11 break-all">{new URL(link).hostname.replace(/^www\./, '')} <ExternalLink size={14} className="shrink-0" /></a>
            ) : source.trim() ? (
                <p className="text-sm text-slate-700">{source}</p>
            ) : (
                <p className="text-sm text-amber-800 rounded-lg bg-amber-50 px-3 py-2">No source yet. Add the link or document this answer comes from, so agents can trust it.</p>
            )}
            <p className="text-xs text-slate-500">This is TLC&apos;s own article, not from an official page HUB reads, so HUB can&apos;t check its figures. Compare each figure and date with the source yourself.</p>
        </section>
    )
}
