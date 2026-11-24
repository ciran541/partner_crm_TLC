'use client'

import { useState } from 'react'
import { ExternalLink, Sparkles } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import MonthPicker from '@/components/insurance/shared/MonthPicker'
import { Empty, ErrorBox, PageTitle, Panel, Tabs, Tile, day, useGet, when } from '@/components/admin/ui'
import { featureLabel, groupBy, inScope, modelLabel, monthDays, projectMonth, totals, usd, type SpendRow } from '@/lib/ai/spendStats'

interface Data { rows: SpendRow[]; account_problem_at: string | null; today: string }
type Env = 'all' | 'production' | 'other'

const num = (n: number) => n.toLocaleString('en-SG')
const callsText = (n: number) => `${num(n)} ${n === 1 ? 'call' : 'calls'}`

/** What the HUB's AI features cost, estimated from tokens used. */
export default function AiSpendPage() {
    const { data, error } = useGet<Data>('/api/admin/ai-spend')
    const [picked, setPicked] = useState<string | null>(null)
    const [pickedDay, setPickedDay] = useState<string | null>(null)
    const [env, setEnv] = useState<Env>('all')

    const title = (
        <PageTitle icon={Sparkles} title="AI Spend" subtitle="Estimated from usage, in US dollars. Gemini counts as free. Your Claude Console bill is the final figure."
            action={<a href="https://platform.claude.com" target="_blank" rel="noopener noreferrer" className="min-h-[44px] px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-[#0369a1] inline-flex items-center gap-2">Claude Console <ExternalLink size={14} /></a>} />
    )
    if (error && !data) return <div className="space-y-5">{title}<ErrorBox message={error} /></div>
    if (!data) return <div className="space-y-5">{title}<Skeleton height={320} radius={14} /></div>

    const month = data.today.slice(0, 7)
    const period = picked ?? month
    const isMonth = period.length === 7
    // A day belongs to the month on screen.
    const oneDay = isMonth && pickedDay?.startsWith(period) ? pickedDay : null
    const scope = oneDay ?? period
    const envRows = data.rows.filter(r => env === 'all' || (r.environment === 'production') === (env === 'production'))
    const rows = envRows.filter(r => inScope(r.day, scope))
    const t = totals(rows)
    const projected = period === month && !oneDay ? projectMonth(envRows, data.today) : null
    const years = [...new Set([data.today, ...data.rows.map(r => r.day)].map(d => Number(d.slice(0, 4))))].sort((a, b) => b - a)
    const features = groupBy(rows, r => r.feature)
    const models = groupBy(rows, r => r.model)
    const days = groupBy(rows, r => r.day).sort((a, b) => b.key.localeCompare(a.key))
    const top = Math.max(...features.map(f => f.cost), 0)

    return (
        <div className="space-y-5">
            {title}
            {error && <ErrorBox message={error} />}
            {data.account_problem_at && <ErrorBox message={`AI is not working: Claude rejected the account on ${when(data.account_problem_at)}. Check the credit balance and API key in the Claude Console.`} />}

            <Tabs<Env> value={env} onChange={setEnv} tabs={[{ key: 'all', label: 'Everything' }, { key: 'production', label: 'Live HUB' }, { key: 'other', label: 'Testing' }]} />
            <section className="card p-4 sm:p-5">
                <MonthPicker scope={period} currentMonth={month} years={years} onScope={s => { setPicked(s); setPickedDay(null) }}
                    tile={m => {
                        const x = totals(envRows.filter(r => r.day.startsWith(m)))
                        return { weight: x.cost, main: x.calls ? usd(x.cost) : '', sub: x.calls ? `${callsText(x.calls)}` : undefined }
                    }} />
                {isMonth && <DayPicker month={period} today={data.today} value={oneDay} rows={envRows}
                    onChange={setPickedDay} onToday={() => { setPicked(month); setPickedDay(data.today) }} />}
            </section>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label={oneDay ? `Spent on ${day(oneDay)}` : 'Spent'} value={usd(t.cost)} sub={t.unpriced > 0 ? `plus ${num(t.unpriced)} calls with no known price` : `${num(t.input + t.output)} tokens`} />
                <Tile label="Today" value={usd(totals(envRows.filter(r => r.day === data.today)).cost)} />
                <Tile label="Expected this month" value={projected == null ? '—' : usd(projected)}
                    sub={period !== month || oneDay ? 'Current month only' : projected == null ? 'Needs 3 days of usage' : 'From tracked days, at the current pace'} />
                <Tile label="AI calls" value={num(t.calls)} tone={t.failed > 0 ? 'warn' : undefined} sub={t.failed > 0 ? `${num(t.failed)} failed` : 'None failed'} />
            </div>

            {rows.length === 0 ? <div className="card"><Empty>No AI usage recorded for this period.</Empty></div> : (
                <>
                    <Panel title="By feature" subtitle="Most expensive first">
                        <ul className="space-y-3">
                            {features.map(f => (
                                <li key={f.key}>
                                    <div className="flex items-baseline justify-between gap-3 text-sm">
                                        <span className="font-semibold text-slate-700">{featureLabel(f.key)}</span>
                                        <span className="font-bold text-[#052d4a] whitespace-nowrap">{usd(f.cost)}</span>
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-100 mt-1.5 overflow-hidden">
                                        <div className="h-full rounded-full bg-[#03a9e7]" style={{ width: top ? `${f.cost / top * 100}%` : 0 }} />
                                    </div>
                                    <p className="text-xs text-slate-500 mt-1">{callsText(f.calls)} · {usd(f.cost / f.calls)} each{f.failed > 0 && ` · ${num(f.failed)} failed`}</p>
                                </li>
                            ))}
                        </ul>
                    </Panel>
                    <Panel title="By model">
                        <ul className="divide-y divide-slate-100">
                            {models.map(m => <Line key={m.key} label={modelLabel(m.key)} sub={`${callsText(m.calls)}`} cost={m.cost} />)}
                        </ul>
                    </Panel>
                    {!isMonth && <Panel title="By day" subtitle="Newest first">
                        <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                            {days.map(d => <Line key={d.key} label={day(d.key)} sub={`${callsText(d.calls)}${d.failed > 0 ? `, ${num(d.failed)} failed` : ''}`} cost={d.cost} />)}
                        </ul>
                    </Panel>}
                </>
            )}
        </div>
    )
}

function DayPicker({ month, today, value, rows, onChange, onToday }: {
    month: string; today: string; value: string | null; rows: SpendRow[]
    onChange: (d: string | null) => void; onToday: () => void
}) {
    const { blanks, days } = monthDays(month)
    const byDay = new Map(groupBy(rows.filter(r => r.day.startsWith(month)), r => r.day).map(d => [d.key, d]))
    const most = Math.max(...[...byDay.values()].map(d => d.cost), 0)
    const btn = 'min-h-11 px-3.5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-600 disabled:opacity-40'
    return (
        <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm font-semibold text-slate-700">{value ? day(value) : 'Pick a day'}</p>
                <div className="flex gap-2">
                    <button type="button" onClick={onToday} disabled={value === today} className={btn}>Today</button>
                    <button type="button" onClick={() => onChange(null)} disabled={!value} className={btn}>Whole month</button>
                </div>
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => <p key={w} className="text-center text-xs text-slate-400">{w}</p>)}
                {Array.from({ length: blanks }, (_, i) => <span key={i} />)}
                {days.map(d => {
                    const x = byDay.get(d)
                    const on = d === value
                    return (
                        <button key={d} type="button" disabled={d > today} aria-pressed={on} onClick={() => onChange(on ? null : d)}
                            aria-label={`${day(d)}, ${x ? `${usd(x.cost)}, ${callsText(x.calls)}` : 'no calls'}`}
                            style={x && !on ? { backgroundColor: `rgba(3,169,231,${0.1 + (most ? x.cost / most : 0) * 0.25})` } : undefined}
                            className={`min-h-12 min-w-0 rounded-lg px-0.5 py-1 text-center disabled:opacity-30 ${on ? 'bg-[#052d4a] text-white' : 'bg-slate-50 text-[#052d4a]'} ${d === today && !on ? 'ring-1 ring-[#03a9e7]' : ''}`}>
                            <span className={`block text-xs ${on ? 'text-white/80' : 'text-slate-500'}`}>{Number(d.slice(8))}</span>
                            <span className="block text-[11px] sm:text-sm font-bold tabular-nums truncate">{!x ? '—' : x.cost > 0 && x.cost < 0.001 ? '<0.001' : usd(x.cost)}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

function Line({ label, sub, cost }: { label: string; sub: string; cost: number }) {
    return (
        <li className="py-2.5 flex justify-between gap-3 text-sm">
            <span className="text-slate-700">{label} <span className="text-xs text-slate-500">{sub}</span></span>
            <b className="text-[#052d4a] whitespace-nowrap">{usd(cost)}</b>
        </li>
    )
}
