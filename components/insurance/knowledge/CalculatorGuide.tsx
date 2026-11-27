'use client'

import { useEffect, useState } from 'react'
import { Calculator, ChevronDown, ExternalLink, Lock } from 'lucide-react'
import { CALC_GUIDES, type CalcGuide, type GuideTable } from '@/lib/insurance/calculatorGuide'
import { runCalc, type CalcKind, type CalcValues } from '@/lib/insurance/knowledgeCalc'
import { CalcCard } from './KnowledgeReply'

const H = 'text-xs font-bold uppercase tracking-wide text-slate-500 mb-2'

/**
 * Admin: what each Knowledge calculator does and the rules it uses. Read-only:
 * everything shown comes from the calculators' own code, so it always matches
 * what agents are told.
 */
export default function CalculatorGuide({ focus }: { focus?: CalcKind | null }) {
    const [open, setOpen] = useState<CalcKind | null>(focus ?? null)
    // Opened from a changed official page: go straight to that calculator.
    useEffect(() => { if (focus) document.getElementById(`calc-${focus}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }, [focus])
    return (
        <div className="space-y-4">
            <p className="text-sm text-slate-600">
                These answer agents&apos; sums with no AI. Each one shows the rules it uses, taken from the same code that answers agents,
                so what you see here is exactly what agents are told.
            </p>
            <p className="text-sm rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-slate-600 flex gap-2">
                <Lock size={16} className="shrink-0 mt-0.5 text-slate-400" />
                <span>To change a rate or rule (for example, new ABSD rates), ask the developer: it is a code change with tests, so a typo can&apos;t misquote a client. Official pages tells you when IRAS or MAS changes a page these rely on.</span>
            </p>
            <ul className="space-y-3">
                {CALC_GUIDES.map(g => (
                    <GuideCard key={g.kind} g={g} open={open === g.kind} onToggle={() => setOpen(open === g.kind ? null : g.kind)} />
                ))}
            </ul>
        </div>
    )
}

function GuideCard({ g, open, onToggle }: { g: CalcGuide; open: boolean; onToggle: () => void }) {
    const title = runCalc(g.kind, '').title
    return (
        <li id={`calc-${g.kind}`} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <button onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-3 px-4 py-4 text-left hover:bg-slate-50">
                <span className="w-10 h-10 shrink-0 rounded-xl bg-sky-50 text-[#0369a1] grid place-items-center"><Calculator size={18} /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold text-[#052d4a]">{title}</span>
                    <span className="block text-sm text-slate-600">{g.answers}</span>
                </span>
                <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="border-t border-slate-100 px-4 py-5 grid lg:grid-cols-2 gap-6">
                    <div className="space-y-5 min-w-0">
                        <section>
                            <p className={H}>Agents ask</p>
                            <ul className="flex flex-wrap gap-2">{g.examples.map(q => <li key={q} className="text-sm rounded-full bg-slate-100 text-slate-700 px-3 py-1.5">&ldquo;{q}&rdquo;</li>)}</ul>
                        </section>
                        <section>
                            <p className={H}>How it works</p>
                            <ol className="space-y-1.5 text-sm text-slate-700 list-decimal pl-5">{g.steps.map(s => <li key={s}>{s}</li>)}</ol>
                        </section>
                        {g.tables.map(t => (
                            <section key={t.title}>
                                <p className={H}>{t.title}</p>
                                <Table t={t.table} />
                            </section>
                        ))}
                        {g.notFor && (
                            <section>
                                <p className={H}>Doesn&apos;t cover</p>
                                <p className="text-sm text-slate-700">{g.notFor}</p>
                            </section>
                        )}
                        <section>
                            <p className={H}>Rules come from</p>
                            {g.source.url
                                ? <a href={g.source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[#0369a1] inline-flex items-center gap-1 min-h-11">{g.source.name} <ExternalLink size={13} /></a>
                                : <p className="text-sm text-slate-700">{g.source.name}</p>}
                        </section>
                    </div>
                    <TryIt g={g} />
                </div>
            )}
        </li>
    )
}

/** The real calculator, as agents see it, filled with an example to change. */
function TryIt({ g }: { g: CalcGuide }) {
    const [run, setRun] = useState({ n: 0, calc: runCalc(g.kind, '', g.sample) })
    return (
        <section className="min-w-0">
            <p className={H}>Try it (exactly what agents see)</p>
            <CalcCard key={run.n} calc={run.calc} busy={false}
                onCalc={(_, values: CalcValues) => setRun(r => ({ n: r.n + 1, calc: runCalc(g.kind, '', values) }))} />
        </section>
    )
}

function Table({ t }: { t: GuideTable }) {
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left">
                    <tr>{t.head.map((h, i) => <th key={i} className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-3 py-2 ${j === 0 ? 'text-slate-700' : 'text-[#052d4a] font-semibold tabular-nums'}`}>{c}</td>)}</tr>)}
                </tbody>
            </table>
        </div>
    )
}
