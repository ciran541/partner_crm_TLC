'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Activity, ArrowRight, BookOpen, Calculator, ChevronDown, CircleHelp, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react'
import { KnowledgeArticle } from '@/lib/types/knowledge'
import type { CalcLine, CalcReply, CalcValues } from '@/lib/insurance/knowledgeCalc'
import type { LiveReply, LiveRow } from '@/lib/insurance/knowledgeLive'
import { ArticleSource } from './KnowledgeArticleView'

type Source = Pick<KnowledgeArticle, 'id' | 'title' | 'content' | 'source' | 'checked_by' | 'checked_on'>

export type AskResult = { sources: Source[]; more?: Source[] } & (
    | { type: 'live'; live: LiveReply }
    | { type: 'calc'; calc: CalcReply }
    | { type: 'answer'; answer: string; logId: string | null }
    | { type: 'article' | 'related' | 'none' }
)

interface Props {
    result: AskResult
    question: string
    busy: boolean
    onCalc: (kind: string, values: CalcValues) => void
    onAsk: (question: string) => void
}

/** One answer. Each kind says plainly where it came from. */
export default function KnowledgeReply({ result, question, busy, onCalc, onAsk }: Props) {
    switch (result.type) {
        case 'live': return <LiveCard live={result.live} question={question} onAsk={onAsk} />
        case 'calc': return <CalcCard key={result.calc.kind} calc={result.calc} busy={busy} onCalc={onCalc} />
        case 'answer':
            return (
                <Card icon={<Sparkles size={14} />} label="Written by AI from TLC articles" tone="violet">
                    <p className={BODY}>{result.answer}</p>
                    {result.logId && <Rate key={result.logId} body={{ logId: result.logId }} />}
                    <Fold heading="Articles used" articles={result.sources} />
                </Card>
            )
        case 'article': {
            const a = result.sources[0]
            return (
                <Card icon={<BookOpen size={14} />} label="TLC article" title={a.title}>
                    <p className={BODY}>{a.content}</p>
                    <ArticleSource article={a} />
                    <Rate key={question} body={{ articleId: a.id, question }} />
                    {!!result.more?.length && <Fold heading="Related" articles={result.more} />}
                </Card>
            )
        }
        case 'related':
            return (
                <Card icon={<CircleHelp size={14} />} label="No exact answer yet" tone="amber">
                    <p className={BODY}>Your question has been sent to the admin. These are the closest articles, and may not answer it.</p>
                    <Fold articles={result.sources} />
                </Card>
            )
        case 'none':
            return (
                <Card icon={<CircleHelp size={14} />} label="Not covered yet" tone="amber">
                    <p className={BODY}>Your question has been sent to the admin. Please check with them before advising the client.</p>
                </Card>
            )
    }
}

const BODY = 'text-[15px] text-slate-700 leading-relaxed whitespace-pre-line'
const TONE = {
    sky: 'bg-sky-50 text-[#0369a1]',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-800',
    emerald: 'bg-emerald-50 text-emerald-700',
}

function Card({ icon, label, title, aside, tone = 'sky', children }: {
    icon: React.ReactNode; label: string; title?: string; aside?: string; tone?: keyof typeof TONE; children: React.ReactNode
}) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 ${TONE[tone]}`}>{icon}{label}</span>
                {aside && <span className="text-xs text-slate-400">{aside}</span>}
            </div>
            {title && <h2 className="text-lg font-bold text-[#052d4a] leading-snug mb-3 text-balance">{title}</h2>}
            {children}
        </section>
    )
}

// ── Live ─────────────────────────────────────────────────────────────────────

function LiveCard({ live, question, onAsk }: { live: LiveReply; question: string; onAsk: Props['onAsk'] }) {
    return (
        <Card icon={<Activity size={14} />} label="Live from the HUB" title={live.title} aside={live.asOf} tone="emerald">
            {!!live.filters?.length && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {live.filters.map(f => (
                        <button key={f.question} type="button" aria-pressed={f.on} onClick={() => { if (f.question !== question) onAsk(f.question) }}
                            className={`min-h-11 px-3.5 rounded-full border text-sm font-medium ${f.on ? 'bg-[#052d4a] border-[#052d4a] text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{f.label}</button>
                    ))}
                </div>
            )}
            {live.stats && <Stats lines={live.stats} />}
            {!!live.rows?.length && <Rows rows={live.rows} ranked={live.ranked} />}
            {live.sections?.map(x => (
                <div key={x.heading} className="mt-4">
                    <h3 className="text-sm font-bold text-slate-500 border-b border-slate-200 pb-1.5">{x.heading}</h3>
                    <Rows rows={x.rows} ranked={live.ranked} />
                </div>
            ))}
            <Notes notes={live.notes} warn={live.warning} />
            <Link href={live.href} className="inline-flex items-center gap-1.5 min-h-11 mt-1 text-sm font-semibold text-[#0369a1]">{live.hrefLabel} <ArrowRight size={14} /></Link>
        </Card>
    )
}

const Rows = ({ rows, ranked }: { rows: LiveRow[]; ranked?: boolean }) => (
    <ol className="divide-y divide-slate-100">{rows.map((r, i) => <Row key={i} row={r} first={i === 0 && !!ranked} />)}</ol>
)

function Row({ row, first }: { row: LiveRow; first: boolean }) {
    return (
        <li className="flex items-start justify-between gap-4 py-3.5">
            <div className="min-w-0">
                <p className="text-[15px] font-bold text-[#052d4a]">{row.title}
                    {first && <span className="ml-2 text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 align-middle">Lowest</span>}
                </p>
                {row.subtitle && <p className="text-sm text-slate-600">{row.subtitle}</p>}
                {row.facts.length > 0 && <p className="text-xs text-slate-500 mt-1">{row.facts.join(' · ')}</p>}
                {row.detail && <p className="text-xs text-slate-500 mt-0.5">{row.detail}</p>}
                {row.warn && <p className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 mt-1"><TriangleAlert size={12} /> {row.warn}</p>}
            </div>
            <div className="text-right shrink-0">
                <p className={`font-bold text-[#052d4a] tabular-nums ${row.big ? 'text-xl' : 'text-sm'}`}>{row.value}</p>
                {row.valueNote && <p className="text-xs text-slate-400">{row.valueNote}</p>}
            </div>
        </li>
    )
}

// ── Calculator ───────────────────────────────────────────────────────────────

function CalcCard({ calc, busy, onCalc }: { calc: CalcReply; busy: boolean; onCalc: Props['onCalc'] }) {
    const [values, setValues] = useState<CalcValues>(calc.values)
    const ready = calc.fields.every(f => values[f.key] !== undefined && values[f.key] !== '')
    const changed = calc.fields.some(f => String(values[f.key] ?? '') !== String(calc.values[f.key] ?? ''))
    const main = calc.result?.lines.filter(l => l.main) ?? []
    const rest = calc.result?.lines.filter(l => !l.main) ?? []

    return (
        <Card icon={<Calculator size={14} />} label="HUB calculator" title={calc.title}>
            {calc.result && (
                <div className={changed ? 'opacity-40' : ''}>
                    <Stats lines={main} />
                    {rest.length > 0 && (
                        <dl className="mt-4 space-y-1.5">
                            {rest.map((l, i) => (
                                <div key={i} className="flex justify-between gap-4 text-sm">
                                    <dt className="text-slate-500">{l.label}</dt>
                                    <dd className="text-slate-700 text-right tabular-nums">{l.value}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                    <Notes notes={calc.result.notes} />
                </div>
            )}
            {calc.error && <p className="text-sm text-red-600">{calc.error}</p>}

            {/* Figures read from the question stay visible, so a misread one can be corrected. */}
            <form onSubmit={e => { e.preventDefault(); if (ready && !busy) onCalc(calc.kind, values) }} className={calc.result || calc.error ? 'mt-5 pt-4 border-t border-slate-100' : ''}>
                <p className="text-sm text-slate-600 mb-3">{calc.result ? 'Worked out from these figures:' : 'Fill in the missing figures:'}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {calc.fields.map(f => (
                        <label key={f.key} className="block text-xs font-semibold text-slate-600">
                            {f.label}
                            {f.type === 'select' ? (
                                <select value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className={INPUT}>
                                    <option value="">Choose…</option>
                                    {f.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            ) : (
                                <input type="number" inputMode="decimal" step="any" min={f.min} max={f.max} value={values[f.key] ?? ''}
                                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} className={INPUT} />
                            )}
                        </label>
                    ))}
                </div>
                {(!calc.result || changed) && (
                    <button type="submit" disabled={!ready || busy} className="btn-primary mt-4 min-h-11 px-5 text-sm disabled:opacity-40">{calc.result ? 'Update' : 'Calculate'}</button>
                )}
            </form>
        </Card>
    )
}

const INPUT = 'mt-1 w-full min-h-11 px-3 text-base sm:text-sm font-normal text-slate-800 rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/15'

// ── Shared ───────────────────────────────────────────────────────────────────

const Stats = ({ lines }: { lines: Pick<CalcLine, 'label' | 'value'>[] }) => (
    <dl className={`grid gap-x-6 gap-y-4 ${lines.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : lines.length > 1 ? 'grid-cols-1 sm:grid-cols-2' : ''}`}>
        {lines.map((l, i) => (
            <div key={i}>
                <dt className="text-xs text-slate-500">{l.label}</dt>
                <dd className="text-2xl font-bold text-[#052d4a] tabular-nums">{l.value}</dd>
            </div>
        ))}
    </dl>
)

const Notes = ({ notes, warn }: { notes: string[]; warn?: string | null }) => (
    <>
        {warn && <p className="flex items-start gap-1.5 mt-3 text-sm rounded-lg bg-amber-50 text-amber-800 px-3 py-2"><TriangleAlert size={15} className="shrink-0 mt-0.5" /> {warn}</p>}
        {notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-500">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
    </>
)

function Fold({ heading, articles }: { heading?: string; articles: Source[] }) {
    return (
        <div className="mt-4 pt-3 border-t border-slate-100">
            {heading && <p className="text-xs font-semibold text-slate-500 mb-1">{heading}</p>}
            {articles.map(a => (
                <details key={a.id} className="group border-b border-slate-100 last:border-0">
                    <summary className="flex items-center justify-between gap-3 min-h-11 cursor-pointer list-none text-sm font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
                        {a.title}
                        <ChevronDown size={16} className="shrink-0 text-slate-400 group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="pb-3">
                        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{a.content}</p>
                        <ArticleSource article={a} />
                    </div>
                </details>
            ))}
        </div>
    )
}

function Rate({ body }: { body: Record<string, string> }) {
    const [state, setState] = useState<'idle' | 'saving' | 'good' | 'bad' | 'failed'>('idle')
    const send = async (good: boolean) => {
        setState('saving')
        try {
            const res = await fetch('/api/insurance/knowledge/rate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, good }) })
            setState(!res.ok ? 'failed' : good ? 'good' : 'bad')
        } catch { setState('failed') }
    }
    if (state === 'good') return <p className="text-sm text-slate-500 mt-4">Thanks.</p>
    if (state === 'bad') return <p className="text-sm text-slate-500 mt-4">Thanks. The admin will check this answer. Don&apos;t rely on it until then.</p>
    const btn = 'inline-flex items-center gap-1.5 min-h-11 px-3.5 text-sm font-medium rounded-full border border-slate-200 bg-white text-slate-600 hover:border-slate-300 disabled:opacity-40'
    return (
        <div className="flex flex-wrap items-center gap-2 mt-4">
            <button type="button" disabled={state === 'saving'} onClick={() => send(true)} className={btn}><ThumbsUp size={14} /> Correct</button>
            <button type="button" disabled={state === 'saving'} onClick={() => send(false)} className={btn}><ThumbsDown size={14} /> Wrong</button>
            {state === 'failed' && <span className="text-sm text-red-600">Couldn&apos;t save. Please try again.</span>}
        </div>
    )
}
