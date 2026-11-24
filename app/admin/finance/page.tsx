'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { BarChart3, Info, TrendingDown, TrendingUp } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { YearPicker, compact } from '@/components/insurance/shared/MonthPicker'
import MonthBars from '@/components/admin/MonthBars'
import { Empty, ErrorBox, FIELD, PageTitle, Panel, Tabs, Tile, money, useGet } from '@/components/admin/ui'
import {
    agentRanking, breakdown, cashHeld, compare, forAgent, moved, owed, owedByBank, pipelineByStage, refiByYear, trend,
    type Breakdown, type FinanceOverview, type Metric, type Owed,
} from '@/lib/insurance/financeStats'
import { OPEN_STAGES, stageLabel } from '@/lib/insurance/stages'
import { leadSourceLabel } from '@/lib/insurance/leadSources'
import { todaySgt } from '@/lib/insurance/promotions'

/**
 * TLC Dashboard — how the business is doing (Premium). Same rules and controls as
 * the agent Dashboard: one year picker, tap a month on the trend to narrow, same
 * months compared with last year. Agent picker covers the whole page.
 * All maths: lib/insurance/financeStats.ts. Data: GET /api/admin/finance/overview.
 */

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function FinancePage() {
    return <Suspense fallback={<Skeleton height={320} radius={14} />}><Content /></Suspense>
}

function Content() {
    const router = useRouter()
    const agent = useSearchParams().get('agent')
    const currentMonth = todaySgt().slice(0, 7)
    const thisYear = Number(currentMonth.slice(0, 4))
    const { data, error } = useGet<FinanceOverview>('/api/admin/finance/overview')
    const [year, setYear] = useState(thisYear)
    const [month, setMonth] = useState<number | null>(null)
    const [metric, setMetric] = useState<Metric>('tlc')
    const [by, setBy] = useState<'bank' | 'source' | 'type'>('bank')

    const d = useMemo(() => (data ? forAgent(data, agent) : null), [data, agent])
    const years = useMemo(() => {
        const ys = [...(data?.closed ?? []), ...(data?.payouts ?? []), ...(data?.receipts ?? [])].map(r => Number(r.month.slice(0, 4)))
        const first = Math.min(thisYear, ...ys.filter(y => y > 2000))
        return Array.from({ length: thisYear - first + 1 }, (_, i) => thisYear - i)
    }, [data, thisYear])

    const scope = month == null ? String(year) : `${year}-${String(month + 1).padStart(2, '0')}`
    const period = month == null ? String(year) : `${LONG[month]} ${year}`

    return (
        <div className="space-y-5">
            <PageTitle icon={BarChart3} title="TLC Dashboard" subtitle="Premium: what TLC earned, what's owed, and where it comes from."
                action={
                    <div className="flex items-center gap-2 flex-wrap">
                        <select aria-label="Agent" className={FIELD} value={agent ?? ''} onChange={e => router.replace(e.target.value ? `/admin/finance?agent=${e.target.value}` : '/admin/finance')}>
                            <option value="">All agents</option>
                            {(data?.agents ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <div className="card px-2 py-1"><YearPicker year={year} years={years} maxYear={thisYear} onChange={y => { setYear(y); setMonth(null) }} /></div>
                    </div>
                } />
            {error && <ErrorBox message={error} />}
            {!d ? !error && <><Skeleton height={170} radius={14} /><Skeleton height={260} radius={14} /></> : (
                <>
                    <Revenue d={d} scope={scope} period={period} currentMonth={currentMonth} month={month} onClear={() => setMonth(null)} year={year} />
                    <Panel title="Trend" subtitle={`Month by month in ${year}. Tap a month to see it above and below.`}
                        action={<Tabs value={metric} onChange={setMetric} tabs={[{ key: 'tlc', label: 'TLC revenue' }, { key: 'volume', label: 'Loans' }, { key: 'cases', label: 'Cases' }]} />}>
                        <MonthBars year={year} lastIdx={year === thisYear ? Number(currentMonth.slice(5)) - 1 : 11}
                            now={trend(d.closed, year, metric)} before={trend(d.closed, year - 1, metric)}
                            format={n => (metric === 'cases' ? String(n) : compact(n))}
                            selected={month} onSelect={i => setMonth(m => (m === i ? null : i))} />
                    </Panel>
                    <Cash d={d} scope={scope} period={period} />
                    {!agent && <Agents d={d} scope={scope} period={period} />}
                    <Panel title={`Where business comes from · ${period}`} subtitle="Closed cases, ranked by TLC revenue."
                        action={<Tabs value={by} onChange={setBy} tabs={[{ key: 'bank', label: 'Bank' }, { key: 'source', label: 'Lead source' }, { key: 'type', label: 'Case type' }]} />}>
                        <Ranked rows={breakdown(d.closed, by, scope)} label={k => (by === 'source' ? leadSourceLabel(k) : k)} />
                    </Panel>
                    <div className="grid lg:grid-cols-2 gap-5 items-start">
                        <Pipeline d={d} />
                        <Refi d={d} currentMonth={currentMonth} />
                    </div>
                </>
            )}
        </div>
    )
}

function Revenue({ d, scope, period, currentMonth, month, onClear, year }: { d: FinanceOverview; scope: string; period: string; currentMonth: string; month: number | null; onClear: () => void; year: number }) {
    const c = compare(d.closed, scope, currentMonth)
    const g = c.growthPct
    return (
        <Panel title={`TLC revenue · ${period}`} subtitle="Cases marked Closed Won in the period. TLC keeps 10% of the 0.15%, plus correction fees."
            action={month != null ? <button type="button" onClick={onClear} className="h-11 px-4 rounded-full border border-[#03a9e7] text-sm font-semibold text-[#0369a1] hover:bg-sky-50">Show all of {year}</button> : undefined}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="TLC revenue" value={money(c.now.tlc)} sub={c.now.fees > 0 ? `includes ${money(c.now.fees)} correction fees` : undefined} />
                <Tile label="Gross commission (0.15%)" value={money(c.now.gross)} />
                <Tile label="Agents' share" value={money(c.now.agentShare)} />
                <Tile label="Revenue growth" tone={g == null ? undefined : g >= 0 ? 'good' : 'bad'} value={g == null ? '—' : `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`}
                    sub={<span className="inline-flex items-center gap-1">{g != null && (g >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}{g == null ? `Nothing to compare (${c.label})` : c.label}</span>} />
                <Tile label="Loans closed" value={compact(c.now.volume)} />
                <Tile label="Cases closed" value={String(c.now.cases)} />
                <Tile label="Average loan" value={c.now.average == null ? '—' : compact(c.now.average)} />
                <Tile label="Revenue last year" value={money(c.before.tlc)} sub={c.label} />
            </div>
        </Panel>
    )
}

function Ageing({ title, o }: { title: string; o: Owed }) {
    const parts = [{ l: '0–30 days', v: o.d30, c: '#03a9e7' }, { l: '31–60 days', v: o.d60, c: '#f59e0b' }, { l: 'Over 60 days', v: o.older, c: '#dc2626' }]
    return (
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-end justify-between gap-2">
                <p className="text-sm font-bold text-[#052d4a]">{title}</p>
                <p className="text-lg font-extrabold text-[#052d4a]">{money(o.amount)} <span className="text-xs font-medium text-slate-500">{o.cases} case{o.cases === 1 ? '' : 's'}</span></p>
            </div>
            {o.amount > 0 && <div className="flex h-3 rounded-full overflow-hidden gap-[2px]">{parts.map(p => p.v > 0 && <div key={p.l} style={{ width: `${(p.v / o.amount) * 100}%`, background: p.c }} />)}</div>}
            <div className="flex gap-x-4 gap-y-1 flex-wrap text-xs text-slate-600">
                {parts.map(p => <span key={p.l} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: p.c }} />{p.l} {money(p.v)}</span>)}
            </div>
        </div>
    )
}

function Cash({ d, scope, period }: { d: FinanceOverview; scope: string; period: string }) {
    const banks = owedByBank(d.bank_owed)
    return (
        <Panel title="Money in and out" subtitle="Received and paid follow the date the money moved. Amounts owed are as of today, aged from the closing date."
            action={<Link href="/admin/payouts" className="text-sm font-semibold text-[#0369a1]">Payouts</Link>}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Tile label={`Received from banks · ${period}`} value={money(moved(d.receipts, scope))} tone="good" />
                <Tile label={`Paid to agents · ${period}`} value={money(moved(d.payouts, scope))} />
                <Tile label="Commission cash held (all time)" value={money(cashHeld(d))} tone={cashHeld(d) < 0 ? 'bad' : undefined} sub={cashHeld(d) < 0 ? 'Agents have been paid ahead of the banks' : 'Received minus paid to agents'} />
            </div>
            <div className="grid lg:grid-cols-2 gap-3">
                <Ageing title="Owed to agents" o={owed(d.agent_owed)} />
                <Ageing title="Owed by banks" o={owed(d.bank_owed)} />
            </div>
            {banks.length > 0 && (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-100"><th className="table-th">Bank</th><th className="table-th" style={{ textAlign: 'right' }}>Cases</th><th className="table-th" style={{ textAlign: 'right' }}>Over 60 days</th><th className="table-th" style={{ textAlign: 'right' }}>Owed</th></tr></thead>
                    <tbody>{banks.map(b => <tr key={b.bank} className="border-b border-slate-50"><td className="px-4 py-2.5 font-semibold text-slate-700">{b.bank}</td><td className="px-4 py-2.5 text-right">{b.cases}</td><td className="px-4 py-2.5 text-right">{b.older > 0 ? <span className="text-red-600 font-semibold">{money(b.older)}</span> : '—'}</td><td className="px-4 py-2.5 text-right font-bold">{money(b.amount)}</td></tr>)}</tbody>
                </table></div>
            )}
            <p className="text-[11px] text-slate-500 flex gap-2"><Info size={13} className="shrink-0 mt-0.5" /><span>Cases paid to agents before bank payments were tracked are left out of cash held and bank amounts, because what the bank paid isn&apos;t on record. They do count in &ldquo;Paid to agents&rdquo;.</span></p>
        </Panel>
    )
}

function Agents({ d, scope, period }: { d: FinanceOverview; scope: string; period: string }) {
    const rows = agentRanking(d, scope)
    const num = 'px-4 py-3 text-right tabular-nums'
    return (
        <Panel title={`Agents · ${period}`} subtitle="Ranked by TLC revenue. Conversion is leads first activated in the period that have been won so far. Owed is as of today.">
            {rows.length === 0 ? <Empty>No Premium agents yet.</Empty> : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-100"><th className="table-th">Agent</th>{['Cases', 'Loans', 'TLC revenue', 'Leads', 'Conversion', 'Owed'].map(h => <th key={h} className="table-th" style={{ textAlign: 'right' }}>{h}</th>)}</tr></thead>
                    <tbody>
                        {rows.map(a => (
                            <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                                <td className="px-4 py-3 font-semibold"><Link href={`/admin/users/${a.id}`} className="text-[#0369a1]">{a.name}</Link></td>
                                <td className={num}>{a.cases}</td><td className={num}>{a.volume ? compact(a.volume) : '—'}</td><td className={`${num} font-bold`}>{money(a.tlc)}</td>
                                <td className={num}>{a.leads}</td><td className={num}>{a.conversionPct == null ? '—' : `${a.conversionPct.toFixed(1)}%`}</td>
                                <td className={`${num} ${a.owed > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>{a.owed > 0 ? money(a.owed) : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table></div>
            )}
        </Panel>
    )
}

function Ranked({ rows, label }: { rows: Breakdown[]; label: (k: string) => string }) {
    const max = Math.max(1, ...rows.map(r => r.tlc))
    if (!rows.length) return <Empty>Nothing closed in this period.</Empty>
    return (
        <div className="space-y-3">
            {rows.map(r => (
                <div key={r.key} className="grid grid-cols-[110px_1fr_auto] sm:grid-cols-[170px_1fr_auto] gap-3 items-center text-sm">
                    <span className={`font-semibold truncate ${/not.set/i.test(r.key) ? 'text-slate-400' : 'text-slate-700'}`}>{label(r.key)}</span>
                    <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.tlc / max) * 100}%`, background: /not.set/i.test(r.key) ? '#cbd5e1' : '#03a9e7' }} /></div>
                    <span className="text-right tabular-nums"><b className="text-[#052d4a]">{money(r.tlc)}</b><span className="block text-xs text-slate-500">{r.cases} · {compact(r.volume)}</span></span>
                </div>
            ))}
        </div>
    )
}

function Pipeline({ d }: { d: FinanceOverview }) {
    const rows = pipelineByStage(d.pipeline, OPEN_STAGES)
    return (
        <Panel title="Pipeline" subtitle="Open cases now. Revenue if every one closed: potential, not a forecast.">
            <ul className="divide-y divide-slate-100">
                {rows.map(r => <li key={r.stage} className="py-2.5 flex justify-between gap-3 text-sm"><span className="font-semibold text-slate-700">{stageLabel(r.stage)}<span className="block text-xs font-normal text-slate-500">{r.cases} case{r.cases === 1 ? '' : 's'} · {compact(r.volume)}</span></span><b className="text-[#052d4a]">{money(r.tlc)}</b></li>)}
                <li className="pt-3 flex justify-between text-sm font-bold text-[#052d4a]"><span>Total</span><span>{money(rows.reduce((s, r) => s + r.tlc, 0))}</span></li>
            </ul>
        </Panel>
    )
}

function Refi({ d, currentMonth }: { d: FinanceOverview; currentMonth: string }) {
    const rows = refiByYear(d.refi, currentMonth)
    return (
        <Panel title="Future refinancing" subtitle="Estimated TLC revenue if each client refinances when their lock-in ends. Cases already revisited are left out.">
            {rows.length === 0 ? <Empty>No lock-in end dates on record.</Empty> : (
                <ul className="divide-y divide-slate-100">
                    {rows.map(r => <li key={r.key} className="py-2.5 flex justify-between gap-3 text-sm"><span className={`font-semibold ${r.key === 'past' ? 'text-amber-700' : 'text-slate-700'}`}>{r.key === 'past' ? 'Lock-in already over' : r.key}<span className="block text-xs font-normal text-slate-500">{r.cases} case{r.cases === 1 ? '' : 's'} · {compact(r.volume)}</span></span><b className="text-[#052d4a]">{money(r.tlc)}</b></li>)}
                </ul>
            )}
        </Panel>
    )
}
