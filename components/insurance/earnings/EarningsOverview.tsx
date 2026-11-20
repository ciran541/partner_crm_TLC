'use client'

import { useEffect, useMemo, useState } from 'react'
import { TrendingDown, TrendingUp, Trophy } from 'lucide-react'

/**
 * Earnings overview — what's owed, what's been received, and how it compares.
 *
 *   [ Month | Year | All Time ]
 *   Awaiting payout  $1,620        Commission received  $3,240
 *   Total outstanding · 1 case     This month
 *   Last month  $2,700                                   ▲ 20.0%
 *
 * Awaiting payout is the current unpaid balance (doesn't change with the
 * period). Commission received counts agent share by the date it was PAID
 * (cases.commission_paid_at, SGT), so it matches what actually reached the
 * agent. All Time's comparison slot shows the best month instead of a
 * meaningless "—".
 */

type Period = 'month' | 'year' | 'all'
interface PaidMonth { month: string; cases: number; agent_share: number }

/** $1,620 / $1,147.50 — never "$1,147.5". */
function money(n: number): string {
    const whole = Math.abs(n - Math.round(n)) < 0.005
    return new Intl.NumberFormat('en-SG', {
        style: 'currency', currency: 'SGD',
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    }).format(n)
}
const monthName = (ym: string, withYear = false) =>
    new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1, 1).toLocaleDateString('en-SG', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' })
function prevMonth(ym: string): string {
    const [y, m] = ym.split('-').map(Number)
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export default function EarningsOverview({ awaiting, awaitingCases, currentMonth, agentId }: {
    awaiting: number
    awaitingCases: number
    currentMonth: string
    agentId?: string
}) {
    const [period, setPeriod] = useState<Period>('month')
    const [paid, setPaid] = useState<PaidMonth[]>([])
    const [loaded, setLoaded] = useState(false)

    useEffect(() => {
        let alive = true
        fetch(`/api/insurance/earnings/paid-by-month${agentId ? `?agent=${agentId}` : ''}`)
            .then(r => (r.ok ? r.json() : { months: [] }))
            .then(d => { if (alive) { setPaid(d.months ?? []); setLoaded(true) } })
            .catch(() => { if (alive) setLoaded(true) })
        return () => { alive = false }
    }, [agentId])

    const sum = useMemo(() => (pred: (ym: string) => boolean) =>
        paid.filter(p => pred(p.month)).reduce((s, p) => s + Number(p.agent_share), 0), [paid])

    const thisYear = currentMonth.slice(0, 4)
    const lastYear = String(Number(thisYear) - 1)
    const lastMonth = prevMonth(currentMonth)

    const received = period === 'month' ? sum(m => m === currentMonth)
        : period === 'year' ? sum(m => m.startsWith(thisYear))
            : sum(() => true)
    const receivedSub = period === 'month' ? 'This month' : period === 'year' ? `This year (${thisYear})` : 'Since joining HUB'

    const previous = period === 'month' ? sum(m => m === lastMonth) : sum(m => m.startsWith(lastYear))
    const change = previous > 0 ? ((received - previous) / previous) * 100 : null
    const best = paid.reduce<PaidMonth | null>((b, p) => (!b || Number(p.agent_share) > Number(b.agent_share) ? p : b), null)

    const tabs: { key: Period; label: string }[] = [
        { key: 'month', label: 'Month' }, { key: 'year', label: 'Year' }, { key: 'all', label: 'All Time' },
    ]

    return (
        <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-base font-bold text-[#052d4a]">Earnings overview</h2>
                <div className="flex gap-1 p-1 rounded-xl bg-slate-100">
                    {tabs.map(t => (
                        <button key={t.key} type="button" onClick={() => setPeriod(t.key)}
                            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                                period === t.key ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Tile tag="Awaiting payout" tagClass="text-amber-700 bg-amber-50"
                    value={money(awaiting)}
                    sub={`Total outstanding · ${awaitingCases} case${awaitingCases === 1 ? '' : 's'}`} />
                <Tile tag="Commission received" tagClass="text-emerald-700 bg-emerald-50"
                    value={loaded ? money(received) : '…'} sub={receivedSub} />
            </div>

            <div className="rounded-xl border border-slate-200 px-4 py-3.5 flex items-center justify-between gap-3">
                {period === 'all' ? (
                    <>
                        <div>
                            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><Trophy size={13} className="text-amber-500" /> Best month</p>
                            <p className="text-xl font-extrabold text-[#052d4a] mt-0.5">{best ? money(Number(best.agent_share)) : '—'}</p>
                        </div>
                        <p className="text-xs text-slate-500 text-right">{best ? monthName(best.month, true) : 'No payouts yet'}</p>
                    </>
                ) : (
                    <>
                        <div>
                            <p className="text-xs font-semibold text-slate-500">
                                {period === 'month' ? `Last month (${monthName(lastMonth)})` : `Last year (${lastYear})`}
                            </p>
                            <p className="text-xl font-extrabold text-[#052d4a] mt-0.5">{money(previous)}</p>
                        </div>
                        <div className="text-right">
                            {change != null ? (
                                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                                    change >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
                                }`}>
                                    {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                    {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                                </span>
                            ) : null}
                            <p className="text-[11px] text-slate-400 mt-1">Commission received</p>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

function Tile({ tag, tagClass, value, sub }: { tag: string; tagClass: string; value: string; sub: string }) {
    return (
        <div className="rounded-xl border border-slate-200 px-4 py-4">
            <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-md ${tagClass}`}>{tag}</span>
            <p className="text-3xl font-extrabold text-[#052d4a] mt-2.5 leading-none tracking-tight">{value}</p>
            <p className="text-xs text-slate-500 mt-2">{sub}</p>
        </div>
    )
}
