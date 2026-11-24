'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ClipboardList, Search } from 'lucide-react'
import { usePagedCases } from '@/lib/insurance/usePagedCases'
import { caseCommission, commissionBucket } from '@/lib/insurance/commission'
import { INACTIVE_STAGE, PIPELINE_STAGES, stageBadge, stageLabel } from '@/lib/insurance/stages'
import { todaySgt } from '@/lib/insurance/promotions'
import FilterPills from '@/components/shared/FilterPills'
import Skeleton from '@/components/shared/Skeleton'
import TrackBoard from '@/components/insurance/cases/TrackBoard'
import ClosedWonMonthly from '@/components/insurance/cases/ClosedWonMonthly'
import { Empty, ErrorBox, FIELD, PageTitle, Pill, day, money } from '@/components/admin/ui'
import type { CaseType } from '@/lib/types'

/**
 * Premium cases across every agent. Same tabs as the agent's Cases page (Track,
 * each stage, Closed Won by month), view-only: changes are made on the case page.
 */

const CASE_TYPES: CaseType[] = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan', 'Divorce']
const TRACK = 'track'
const TABS = [
    { value: TRACK, label: 'Track' },
    { value: 'all', label: 'All' },
    ...PIPELINE_STAGES.filter(s => s !== INACTIVE_STAGE).map(s => ({ value: s as string, label: stageLabel(s) })),
    { value: INACTIVE_STAGE as string, label: stageLabel(INACTIVE_STAGE) },
]

export default function AdminPremiumCasesPage() {
    return <Suspense fallback={<Skeleton height={320} radius={14} />}><Content /></Suspense>
}

function Content() {
    const router = useRouter()
    const params = useSearchParams()
    const currentMonth = todaySgt().slice(0, 7)
    const [tab, setTab] = useState(() => (TABS.some(t => t.value === params.get('stage')) ? params.get('stage')! : TRACK))
    const [agent, setAgent] = useState(() => params.get('agent') ?? '')
    const [type, setType] = useState('')
    const [search, setSearch] = useState('')
    const [closedMonth, setClosedMonth] = useState(currentMonth)
    const [agents, setAgents] = useState<{ id: string; name: string }[]>([])
    const isTrack = tab === TRACK
    const isWon = tab === 'Closed Won'

    const q = usePagedCases({
        search, stage: tab, caseType: type || undefined, agent: agent || undefined,
        closedMonth: isWon && closedMonth !== 'all' ? closedMonth : undefined,
    }, { enabled: !isTrack })

    useEffect(() => {
        let alive = true
        fetch('/api/admin/get-profiles').then(r => (r.ok ? r.json() : [])).then((list: { id: string; name: string; role: string; app_type: string }[]) => {
            if (alive && Array.isArray(list)) setAgents(list.filter(p => p.role === 'agent' && p.app_type === 'insurance').map(p => ({ id: p.id, name: p.name || 'Unnamed agent' })).sort((a, b) => a.name.localeCompare(b.name)))
        }).catch(() => {})
        return () => { alive = false }
    }, [])

    return (
        <div className="space-y-5">
            <PageTitle icon={ClipboardList} title="Cases" subtitle="Premium cases across every agent." />
            <FilterPills options={TABS} value={tab} onChange={setTab} accentColor="#03a9e7" scrollable />
            <div className="flex flex-wrap gap-2">
                <label className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Client, mobile, email or agent" className={`${FIELD} w-full pl-9`} />
                </label>
                <select aria-label="Agent" className={FIELD} value={agent} onChange={e => setAgent(e.target.value)}>
                    <option value="">All agents</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {!isTrack && <select aria-label="Case type" className={FIELD} value={type} onChange={e => setType(e.target.value)}>
                    <option value="">All types</option>{CASE_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>}
                {(search || agent || type) && <button type="button" onClick={() => { setSearch(''); setAgent(''); setType('') }} className="min-h-[44px] px-2 text-xs text-slate-500">Clear filters</button>}
            </div>

            {isTrack && <TrackBoard search={search} agent={agent || undefined} readOnly hrefFor={id => `/admin/insurance/cases/${id}`} />}
            {isWon && <ClosedWonMonthly key={agent} scope={closedMonth} currentMonth={currentMonth} onScope={setClosedMonth} loanVolume={q.loanVolume} cases={q.total} loading={q.loading || q.refreshing} agent={agent || undefined} />}
            {!isTrack && (q.error ? <ErrorBox message={q.error} /> : q.loading ? <Skeleton height={320} radius={14} /> : q.rows.length === 0 ? <div className="card"><Empty>No cases match.</Empty></div> : (
                <div className="card overflow-hidden transition-opacity" style={{ opacity: q.refreshing ? 0.55 : 1 }}>
                    <div className="overflow-x-auto"><table className="w-full text-sm">
                        <thead><tr className="border-b border-slate-100 bg-slate-50">{['Agent', 'Client', 'Type', 'Stage', 'Follow-up'].map(h => <th key={h} className="table-th">{h}</th>)}{['Loan', 'Agent share'].map(h => <th key={h} className="table-th" style={{ textAlign: 'right' }}>{h}</th>)}<th className="table-th">Payout</th></tr></thead>
                        <tbody className="divide-y divide-slate-50">
                            {q.rows.map(c => {
                                const badge = stageBadge(c.stage)
                                const bucket = commissionBucket(c)
                                const loan = c.loan_value ?? 0
                                const paid = Number(c.commission_paid_total ?? 0)
                                const late = c.follow_up_date && c.follow_up_date.slice(0, 10) < todaySgt()
                                return (
                                    <tr key={c.id} onClick={() => router.push(`/admin/insurance/cases/${c.id}`)} className="hover:bg-sky-50/50 cursor-pointer">
                                        <td className="px-4 py-3 text-slate-600 font-medium">{c.profiles?.name ?? '—'}</td>
                                        <td className="px-4 py-3"><p className="font-semibold text-slate-800">{c.client_name || 'Unnamed'}</p>{c.client_mobile && <p className="text-xs text-slate-500">{c.client_mobile}</p>}</td>
                                        <td className="px-4 py-3 text-slate-600">{c.case_type}</td>
                                        <td className="px-4 py-3"><span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap" style={{ color: badge.text, background: badge.bg }}>{stageLabel(c.stage)}</span></td>
                                        <td className={`px-4 py-3 whitespace-nowrap ${late ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>{day(c.follow_up_date)}</td>
                                        <td className="px-4 py-3 text-right">{loan ? money(loan) : '—'}</td>
                                        <td className="px-4 py-3 text-right font-semibold text-emerald-700">{loan ? money(caseCommission(c).agent) : '—'}</td>
                                        <td className="px-4 py-3">{bucket === 'closed_paid' ? <Pill tone="green">Paid</Pill> : bucket === 'closed_unpaid' ? (paid > 0 ? <Pill tone="blue">Part paid {money(paid)}</Pill> : <Pill tone="amber">Unpaid</Pill>) : <span className="text-slate-300">—</span>}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table></div>
                    <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-500 flex items-center justify-between min-h-[48px]">
                        <span>Showing {q.rows.length} of {q.total}</span>
                        {q.hasMore && <button type="button" onClick={q.loadMore} disabled={q.loadingMore} className="min-h-[44px] px-3 font-semibold text-[#0369a1]">{q.loadingMore ? 'Loading…' : `Load more (${q.total - q.rows.length} remaining)`}</button>}
                    </div>
                </div>
            ))}
        </div>
    )
}
