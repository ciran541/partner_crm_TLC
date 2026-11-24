'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowLeft, CalendarClock, CalendarDays, CalendarPlus, Target } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import { addDays, daysBetween, SOON_DAYS } from '@/lib/insurance/followUps'
import { todaySgt } from '@/lib/insurance/promotions'
import { stageBadge, stageLabel } from '@/lib/insurance/stages'
import { Empty, ErrorBox, PageTitle, Panel, Pill, Tabs, Tile, day, money, useGet } from '@/components/admin/ui'
import type { HealthRow } from '@/components/admin/types'

/**
 * Admin Action Centre — which agents are keeping up with follow-ups. Opens on a
 * list of agents; tap one for their sections (same ones the agent sees). View
 * only: agents own their follow-ups, and admins fix mistakes on the case page.
 */
export default function AdminActionCentrePage() {
    return <Suspense fallback={<Skeleton height={320} radius={14} />}><Content /></Suspense>
}

type Section = 'missing' | 'overdue' | 'today' | 'soon'

function Content() {
    const agent = useSearchParams().get('agent')
    const { data, error } = useGet<{ rows: HealthRow[] }>('/api/admin/follow-up-health')
    const row = data?.rows.find(r => r.agent === agent)
    const add = (k: 'overdue' | 'missing' | 'today' | 'soon', rows: HealthRow[]) => rows.reduce((s, r) => s + r[k], 0)
    const scope = agent ? (row ? [row] : []) : data?.rows ?? []
    return (
        <div className="space-y-5">
            {agent && <Link href="/admin/insurance/follow-ups" className="min-h-[44px] inline-flex items-center gap-1.5 text-sm text-slate-500 no-underline"><ArrowLeft size={15} /> All agents</Link>}
            <PageTitle icon={Target} title={agent ? row?.name ?? 'Agent' : 'Action Centre'} subtitle={agent ? 'Follow-ups this agent needs to act on.' : 'Who is keeping up with follow-ups. Tap an agent for the detail.'} />
            {error && <ErrorBox message={error} />}
            {data && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Tile label="Overdue" value={String(add('overdue', scope))} tone={add('overdue', scope) ? 'bad' : undefined} />
                    <Tile label="Needs a date" value={String(add('missing', scope))} tone={add('missing', scope) ? 'warn' : undefined} />
                    <Tile label="Today" value={String(add('today', scope))} />
                    <Tile label={`Next ${SOON_DAYS} days`} value={String(add('soon', scope))} />
                </div>
            )}
            {agent ? <AgentSections key={agent} agent={agent} /> : !data ? !error && <Skeleton height={300} radius={14} /> : <AgentList rows={data.rows} />}
        </div>
    )
}

function AgentList({ rows }: { rows: HealthRow[] }) {
    const today = todaySgt()
    const router = useRouter()
    const num = 'px-4 py-3 text-right tabular-nums'
    const cell = (n: number, tone: string) => <td className={`${num} ${n > 0 ? tone : 'text-slate-300'}`}>{n}</td>
    if (!rows.length) return <div className="card"><Empty>No Premium agents yet.</Empty></div>
    return (
        <div className="card overflow-x-auto">
            <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-100"><th className="table-th">Agent</th>{['Overdue', 'Needs a date', 'Today', `Next ${SOON_DAYS} days`, 'Open cases'].map(h => <th key={h} className="table-th" style={{ textAlign: 'right' }}>{h}</th>)}<th className="table-th">Oldest overdue</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                    {rows.map(r => (
                        <tr key={r.agent} onClick={() => router.push(`/admin/insurance/follow-ups?agent=${r.agent}`)} className="cursor-pointer hover:bg-sky-50/50">
                            <td className="px-4 py-3 font-semibold"><Link href={`/admin/insurance/follow-ups?agent=${r.agent}`} onClick={e => e.stopPropagation()} className="text-[#0369a1]">{r.name}</Link>{r.status === 'disabled' && <span className="ml-2"><Pill tone="grey">Disabled</Pill></span>}</td>
                            {cell(r.overdue, 'text-red-600 font-bold')}{cell(r.missing, 'text-amber-600 font-bold')}{cell(r.today, 'text-slate-700')}{cell(r.soon, 'text-slate-700')}{cell(r.open_cases, 'text-slate-700')}
                            <td className="px-4 py-3 text-slate-500">{r.oldest ? `${daysBetween(r.oldest, today)} days late` : '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function AgentSections({ agent }: { agent: string }) {
    const today = todaySgt()
    const yesterday = addDays(today, -1)
    const [tab, setTab] = useState<Section>('overdue')
    const common = { stage: 'all', agent, hasFollowUp: true, sort: 'follow_up_date', dir: 'asc' } as const
    const missing = usePagedCases({ stage: 'all', agent, missingFollowUp: true })
    const overdue = usePagedCases({ ...common, followUpTo: yesterday })
    const dueToday = usePagedCases({ ...common, followUpAfter: yesterday, followUpTo: today })
    const soon = usePagedCases({ ...common, followUpAfter: today, followUpTo: addDays(today, SOON_DAYS) })
    const q = { missing, overdue, today: dueToday, soon }[tab]
    return (
        <Panel title="Follow-ups" action={<Tabs value={tab} onChange={setTab} tabs={[
            { key: 'overdue', label: 'Overdue', count: overdue.total }, { key: 'missing', label: 'Needs a date', count: missing.total },
            { key: 'today', label: 'Today', count: dueToday.total }, { key: 'soon', label: `Next ${SOON_DAYS} days`, count: soon.total },
        ]} />}>
            {q.error ? <p className="text-sm text-red-600">{q.error}</p> : q.loading ? <Skeleton height={160} radius={12} /> : q.rows.length === 0 ? <Empty>Nothing here.</Empty> : (
                <div className="divide-y divide-slate-100 -my-2">
                    {q.rows.map(c => <Row key={c.id} c={c} tab={tab} today={today} />)}
                    {q.hasMore && <button type="button" onClick={q.loadMore} disabled={q.loadingMore} className="w-full min-h-[44px] text-sm font-semibold text-[#0369a1]">{q.loadingMore ? 'Loading…' : `Load more (${q.total - q.rows.length} remaining)`}</button>}
                </div>
            )}
        </Panel>
    )
}

const ICON = { missing: CalendarPlus, overdue: AlertCircle, today: CalendarClock, soon: CalendarDays }

function Row({ c, tab, today }: { c: CaseListRow; tab: Section; today: string }) {
    const Icon = ICON[tab]
    const badge = stageBadge(c.stage)
    const date = c.follow_up_date?.slice(0, 10)
    return (
        <Link href={`/admin/insurance/cases/${c.id}`} className="py-3 flex items-center gap-3 flex-wrap no-underline text-sm">
            <Icon size={17} className={tab === 'overdue' ? 'text-red-500' : tab === 'missing' ? 'text-amber-500' : 'text-[#03a9e7]'} />
            <span className="flex-1 min-w-[160px]"><b className="text-slate-800">{c.client_name || 'Unnamed'}</b><span className="block text-xs text-slate-500">{[c.case_type, c.follow_up_remark].filter(Boolean).join(' · ')}</span></span>
            <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ color: badge.text, background: badge.bg }}>{stageLabel(c.stage)}</span>
            {!!c.loan_value && <span className="text-slate-500">{money(c.loan_value)}</span>}
            <span className={`w-[130px] text-right ${tab === 'overdue' ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{date ? day(date) : 'No date'}{tab === 'overdue' && date && <span className="block text-xs">{daysBetween(date, today)} days late</span>}</span>
        </Link>
    )
}
