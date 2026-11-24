'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, LayoutDashboard, TrendingDown, TrendingUp } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { compact } from '@/components/insurance/shared/MonthPicker'
import { Empty, ErrorBox, PageTitle, Panel, Pill, Tile, day, money, useGet } from '@/components/admin/ui'
import { agentOutstanding, bankOutstanding, compare, groupByAgent, splitQueue, type FinanceOverview, type QueueRow } from '@/lib/insurance/financeStats'
import { daysBetween } from '@/lib/insurance/followUps'
import type { HealthRow } from '@/components/admin/types'

interface HomeData {
    today: string
    queue: QueueRow[] | null
    overview: FinanceOverview | null
    health: HealthRow[] | null
    todo: {
        reports: number | null; packageDrafts: number | null; promoDrafts: number | null; gaps: number | null; invites: number | null
        promosEnding: { id: string; bank: string; title: string; ends_on: string }[] | null
        sora: { date: string | null; stale: boolean } | null
    }
}

/** Admin Home — what needs doing today: payouts first, then content, then agents falling behind. */
export default function AdminHomePage() {
    const { data, error } = useGet<HomeData>('/api/admin/home')
    return (
        <div className="space-y-5">
            <PageTitle icon={LayoutDashboard} title="Home" subtitle="What needs doing today." />
            {error && <ErrorBox message={error} />}
            {!data ? !error && <><Skeleton height={170} radius={14} /><Skeleton height={220} radius={14} /></> : (
                <>
                    <PayoutsPanel rows={data.queue} today={data.today} />
                    <div className="grid lg:grid-cols-2 gap-5 items-start">
                        <TodoPanel data={data} />
                        <AgentsPanel rows={data.health} today={data.today} />
                    </div>
                    <MonthPanel d={data.overview} today={data.today} />
                </>
            )}
        </div>
    )
}

const Unchecked = () => <p className="text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={15} /> Couldn&apos;t check this. Refresh to try again.</p>
const GO = 'min-h-[44px] px-4 rounded-xl bg-[#052d4a] text-white text-sm font-bold inline-flex items-center gap-2 no-underline'

function PayoutsPanel({ rows, today }: { rows: QueueRow[] | null; today: string }) {
    if (!rows) return <Panel title="Payouts"><Unchecked /></Panel>
    const s = splitQueue(rows)
    const sum = (list: QueueRow[], f: (r: QueueRow) => number) => list.reduce((t, r) => t + f(r), 0)
    const unpaid = [...s.ready, ...s.waiting]
    const oldest = unpaid.reduce<QueueRow | null>((o, r) => (!o || r.closed_on < o.closed_on ? r : o), null)
    const bankDue = s.bankOpen.filter(r => bankOutstanding(r) > 0)
    return (
        <Panel title="Payouts" subtitle="Premium commission: money in from banks, and out to agents."
            action={<Link href="/admin/payouts" className={GO}>Pay agents <ArrowRight size={16} /></Link>}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Ready to pay" tone={s.ready.length ? 'warn' : undefined} value={money(sum(s.ready, agentOutstanding))}
                    sub={`${s.ready.length} case${s.ready.length === 1 ? '' : 's'} · ${groupByAgent(s.ready).length} agent${groupByAgent(s.ready).length === 1 ? '' : 's'}`} />
                <Tile label="Owed, waiting for bank" value={money(sum(s.waiting, agentOutstanding))} sub={`${s.waiting.length} case${s.waiting.length === 1 ? '' : 's'}`} />
                <Tile label="Banks owe TLC" value={money(sum(bankDue, bankOutstanding))} sub={`${bankDue.length} case${bankDue.length === 1 ? '' : 's'}`} />
                <Tile label="Oldest unpaid case" value={oldest ? `${daysBetween(oldest.closed_on, today)} days` : '—'} tone={oldest && daysBetween(oldest.closed_on, today) > 60 ? 'bad' : undefined}
                    sub={oldest ? `${oldest.client_name || 'Unnamed'} · ${oldest.agent_name}` : 'Everyone is paid'} />
            </div>
            {s.overpaid.length > 0 && <p className="text-sm text-red-600 flex items-center gap-2"><AlertTriangle size={15} /> {s.overpaid.length} case{s.overpaid.length === 1 ? ' has' : 's have'} been paid more than the agent&apos;s share. See Payouts.</p>}
        </Panel>
    )
}

function TodoPanel({ data }: { data: HomeData }) {
    const t = data.todo
    const items: { label: string; href: string; tone: 'amber' | 'red' | 'blue'; value: string }[] = []
    const add = (n: number | null, label: string, href: string, tone: 'amber' | 'blue' = 'amber') => {
        if (n === null) items.push({ label: `${label}: couldn’t check`, href, tone: 'red', value: '!' })
        else if (n > 0) items.push({ label, href, tone, value: String(n) })
    }
    if (!t.sora) add(null, 'SORA', '/admin/insurance/rates')
    else if (t.sora.stale) items.push({ label: t.sora.date ? `SORA is out of date (last ${day(t.sora.date)})` : 'No SORA on record', href: '/admin/insurance/rates', tone: 'red', value: '!' })
    add(t.reports, 'Banks’ Insights to review', '/admin/insurance/bank-intelligence')
    add(t.gaps, 'Knowledge questions without an answer', '/admin/insurance/knowledge')
    add(t.packageDrafts, 'Draft rate packages', '/admin/insurance/rates', 'blue')
    add(t.promoDrafts, 'Draft promotions', '/admin/insurance/promotions', 'blue')
    if (!t.promosEnding) add(null, 'Promotions ending soon', '/admin/insurance/promotions')
    else for (const p of t.promosEnding) items.push({ label: `${p.bank}: ${p.title}`, href: '/admin/insurance/promotions', tone: 'amber', value: `ends ${day(p.ends_on)}` })
    add(t.invites, 'Invites not used yet', '/admin/users', 'blue')
    return (
        <Panel title="To do">
            {items.length === 0 ? (
                <p className="text-sm text-emerald-700 flex items-center gap-2 py-4"><CheckCircle2 size={17} /> Nothing waiting.</p>
            ) : (
                <ul className="divide-y divide-slate-100 -my-2">
                    {items.map(i => (
                        <li key={i.label + i.value}>
                            <Link href={i.href} className="min-h-[48px] py-2 flex items-center justify-between gap-3 no-underline text-sm font-medium text-slate-700 hover:text-[#0369a1]">
                                <span>{i.label}</span><Pill tone={i.tone}>{i.value}</Pill>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </Panel>
    )
}

function AgentsPanel({ rows, today }: { rows: HealthRow[] | null; today: string }) {
    if (!rows) return <Panel title="Agents falling behind"><Unchecked /></Panel>
    const behind = rows.filter(r => r.status !== 'disabled' && r.overdue + r.missing > 0).slice(0, 6)
    return (
        <Panel title="Agents falling behind" subtitle="Overdue follow-ups, and cases with no date."
            action={<Link href="/admin/insurance/follow-ups" className="text-sm font-semibold text-[#0369a1]">Action Centre</Link>}>
            {behind.length === 0 ? <Empty>Every agent is up to date.</Empty> : (
                <ul className="divide-y divide-slate-100 -my-2">
                    {behind.map(r => (
                        <li key={r.agent}>
                            <Link href={`/admin/insurance/follow-ups?agent=${r.agent}`} className="min-h-[48px] py-2 flex items-center justify-between gap-3 no-underline text-sm">
                                <span className="font-semibold text-slate-800">{r.name}{r.oldest && <span className="block text-xs font-normal text-slate-500">oldest is {daysBetween(r.oldest, today)} days late</span>}</span>
                                <span className="flex gap-1.5">
                                    {r.overdue > 0 && <Pill tone="red">{r.overdue} overdue</Pill>}
                                    {r.missing > 0 && <Pill tone="amber">{r.missing} no date</Pill>}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </Panel>
    )
}

function MonthPanel({ d, today }: { d: FinanceOverview | null; today: string }) {
    if (!d) return <Panel title="This month"><Unchecked /></Panel>
    const month = today.slice(0, 7)
    const c = compare(d.closed, month, month)
    return (
        <Panel title="This month for TLC" subtitle="Premium cases marked Closed Won this month." action={<Link href="/admin/finance" className="text-sm font-semibold text-[#0369a1]">TLC Dashboard</Link>}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="TLC revenue" value={money(c.now.tlc)} />
                <Tile label="Loans closed" value={compact(c.now.volume)} />
                <Tile label="Cases closed" value={String(c.now.cases)} />
                <Tile label="Revenue growth" tone={c.growthPct == null ? undefined : c.growthPct >= 0 ? 'good' : 'bad'}
                    value={c.growthPct == null ? '—' : `${c.growthPct >= 0 ? '+' : ''}${c.growthPct.toFixed(1)}%`}
                    sub={<span className="inline-flex items-center gap-1">{c.growthPct != null && (c.growthPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />)} {c.label}</span>} />
            </div>
        </Panel>
    )
}
