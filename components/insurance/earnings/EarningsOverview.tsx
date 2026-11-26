'use client'

import { useEffect, useMemo, useState } from 'react'
import { History, TrendingDown, TrendingUp, Trophy, X } from 'lucide-react'

/**
 * Earnings overview — what's owed, what's been earned, and how it compares.
 *
 *   [ Month | Year | All Time ]                         [ Payout history ]
 *   Awaiting payout  $1,620        Commission earned  $3,240
 *   Total outstanding · 1 case     This month
 *   Last month (October)  $2,700                          ▲ 20.0%
 *
 * Commission EARNED counts the agent's share by the month the case was marked
 * Closed Won (SGT), whether or not TLC has paid it yet (closed_won_by_month's
 * agent_share). Awaiting payout is the current unpaid balance. When TLC
 * actually paid, case by case, lives behind "Payout history".
 */

type Period = 'month' | 'year' | 'all'
interface MonthTotal { month: string; cases: number; agent_share: number }

/** $1,620 / $1,147.50 — never "$1,147.5". */
export function money(n: number): string {
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

export default function EarningsOverview({ awaiting, awaitingCases, earned: months, currentMonth, agentId }: {
    /** null = not known yet (loading or failed). */
    awaiting: number | null
    awaitingCases: number
    /** Earned per closing month; null = not known yet. */
    earned: MonthTotal[] | null
    currentMonth: string
    agentId?: string
}) {
    const [period, setPeriod] = useState<Period>('month')
    const loaded = months != null
    const earned = useMemo(() => months ?? [], [months])
    const [historyOpen, setHistoryOpen] = useState(false)

    const sum = useMemo(() => (pred: (ym: string) => boolean) =>
        earned.filter(p => pred(p.month)).reduce((s, p) => s + Number(p.agent_share ?? 0), 0), [earned])

    const thisYear = currentMonth.slice(0, 4)
    const lastYear = String(Number(thisYear) - 1)
    const lastMonth = prevMonth(currentMonth)

    const total = period === 'month' ? sum(m => m === currentMonth)
        : period === 'year' ? sum(m => m.startsWith(thisYear))
            : sum(() => true)
    const totalSub = period === 'month' ? 'This month' : period === 'year' ? `This year (${thisYear})` : 'Since joining HUB'

    const previous = period === 'month' ? sum(m => m === lastMonth) : sum(m => m.startsWith(lastYear))
    const change = previous > 0 ? ((total - previous) / previous) * 100 : null
    const best = earned.reduce<MonthTotal | null>((b, p) => (!b || Number(p.agent_share) > Number(b.agent_share) ? p : b), null)

    const tabs: { key: Period; label: string }[] = [
        { key: 'month', label: 'Month' }, { key: 'year', label: 'Year' }, { key: 'all', label: 'All Time' },
    ]

    return (
        <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="text-base font-bold text-[#052d4a]">Earnings overview</h2>
                <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={() => setHistoryOpen(true)}
                        className="h-9 px-3.5 rounded-xl border border-slate-200 text-sm font-semibold text-[#0369a1] hover:bg-slate-50 flex items-center gap-1.5">
                        <History size={15} /> Payout history
                    </button>
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Tile tag="Awaiting payout" tagClass="text-amber-700 bg-amber-50"
                    value={awaiting == null ? '…' : money(awaiting)}
                    sub={awaiting == null ? 'Total outstanding' : `Total outstanding · ${awaitingCases} case${awaitingCases === 1 ? '' : 's'}`} />
                <Tile tag="Commission earned" tagClass="text-emerald-700 bg-emerald-50"
                    value={loaded ? money(total) : '…'} sub={totalSub} />
            </div>

            <div className="rounded-xl border border-slate-200 px-4 py-3.5 flex items-center justify-between gap-3">
                {period === 'all' ? (
                    <>
                        <div>
                            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><Trophy size={13} className="text-amber-500" /> Best month</p>
                            <p className="text-xl font-extrabold text-[#052d4a] mt-0.5">{!loaded ? '…' : best ? money(Number(best.agent_share)) : '—'}</p>
                        </div>
                        <p className="text-xs text-slate-500 text-right">{!loaded ? '' : best ? monthName(best.month, true) : 'Nothing closed yet'}</p>
                    </>
                ) : (
                    <>
                        <div>
                            <p className="text-xs font-semibold text-slate-500">
                                {period === 'month' ? `Last month (${monthName(lastMonth)})` : `Last year (${lastYear})`}
                            </p>
                            <p className="text-xl font-extrabold text-[#052d4a] mt-0.5">{loaded ? money(previous) : '…'}</p>
                        </div>
                        <div className="text-right">
                            {change != null && (
                                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${
                                    change >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'
                                }`}>
                                    {change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                    {change >= 0 ? '+' : ''}{change.toFixed(1)}%
                                </span>
                            )}
                            <p className="text-[11px] text-slate-400 mt-1">Commission earned</p>
                        </div>
                    </>
                )}
            </div>

            {historyOpen && <PayoutHistory agentId={agentId} onClose={() => setHistoryOpen(false)} />}
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

/** 'YYYY-MM-DD' → DD/MM/YYYY. */
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

interface PayoutRow {
    id: string
    amount: number
    paid_on: string
    reference: string | null
    reverses: string | null
    cases: { client_name: string | null; case_type: string } | null
}

/**
 * Every payout TLC has made, newest first, grouped by payout date — "on
 * 18/11/2026 TLC paid you $2,767.50". Straight from the payout ledger
 * (GET /api/insurance/payouts): partial payments and reversals each appear as
 * their own dated entry, so nothing is ever overwritten.
 */
function PayoutHistory({ agentId, onClose }: { agentId?: string; onClose: () => void }) {
    const [rows, setRows] = useState<PayoutRow[] | null>(null)
    useEffect(() => {
        let alive = true
        fetch(`/api/insurance/payouts${agentId ? `?agent=${agentId}` : ''}`)
            .then(r => (r.ok ? r.json() : { payouts: [] }))
            .then(d => { if (alive) setRows(d.payouts ?? []) })
            .catch(() => { if (alive) setRows([]) })
        return () => { alive = false }
    }, [agentId])

    const groups = useMemo(() => {
        const byDay = new Map<string, PayoutRow[]>()
        for (const p of rows ?? []) byDay.set(p.paid_on, [...(byDay.get(p.paid_on) ?? []), p])
        return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    }, [rows])

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.55)', backdropFilter: 'blur(3px)' }}
            onClick={onClose}>
            <div className="card w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div>
                        <h3 className="text-base font-bold text-[#052d4a]">Payout history</h3>
                        <p className="text-xs text-slate-500">Every payment TLC has made to you, by date.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100">
                        <X size={18} />
                    </button>
                </div>

                <div className="overflow-y-auto px-5 py-4 space-y-4">
                    {rows === null ? (
                        <p className="text-sm text-slate-400 text-center py-6">Loading…</p>
                    ) : groups.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center py-8">No payouts yet. They&apos;ll appear here as soon as TLC pays a case.</p>
                    ) : groups.map(([day, list]) => {
                        const total = list.reduce((s, p) => s + Number(p.amount), 0)
                        return (
                            <section key={day} className="rounded-xl border border-slate-200 overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50/70">
                                    <p className="text-sm font-bold text-emerald-800">Paid on {dmy(day)}</p>
                                    <p className={`text-sm font-extrabold ${total < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{total < 0 ? `−${money(-total)}` : money(total)}</p>
                                </div>
                                {list.map(p => {
                                    const reversal = Number(p.amount) < 0
                                    return (
                                        <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-100 text-sm">
                                            <div className="min-w-0">
                                                <p className="font-semibold text-slate-800 truncate">{p.cases?.client_name || 'Unnamed'}</p>
                                                <p className="text-xs text-slate-500 truncate">
                                                    {[p.cases?.case_type, reversal ? 'Reversal of an earlier payout' : null, p.reference].filter(Boolean).join(' · ')}
                                                </p>
                                            </div>
                                            <p className={`font-bold shrink-0 ${reversal ? 'text-red-600' : 'text-slate-800'}`}>
                                                {reversal ? `−${money(-Number(p.amount))}` : money(Number(p.amount))}
                                            </p>
                                        </div>
                                    )
                                })}
                            </section>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
