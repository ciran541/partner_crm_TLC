'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardList, AlertCircle, ArrowRight, ChevronDown, Search } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { isDraftCase } from '@/lib/insurance/caseFilters'
import { caseCommission, caseLoanBase, commissionBucket } from '@/lib/insurance/commission'
import type { Case, CaseType, PipelineStage } from '@/lib/types'

const STAGES: PipelineStage[] = [
    'Touched Base', 'Pending Docs', 'Pending Approval', 'Pending Signature', 'Closed Won', 'Closed Lost',
]
const CASE_TYPES: CaseType[] = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan']

const STAGE_BADGE: Record<string, { bg: string; text: string }> = {
    'Closed Won': { bg: '#d1fae5', text: '#065f46' },
    'Closed Lost': { bg: '#fee2e2', text: '#991b1b' },
    'Pending Approval': { bg: '#fff7ed', text: '#9a3412' },
    'Pending Signature': { bg: '#fef3c7', text: '#92400e' },
}
const DEFAULT_STAGE_BADGE = { bg: '#e0f2fe', text: '#0369a1' }

type CaseRow = Case & { profiles?: { id: string; name: string } | null }

export default function AdminInsuranceCasesPage() {
    const router = useRouter()
    const [cases, setCases] = useState<CaseRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [stageFilter, setStageFilter] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [agentFilter, setAgentFilter] = useState('')
    const [search, setSearch] = useState('')

    useEffect(() => {
        supabase
            .from('cases')
            .select('*, profiles ( id, name )')
            .order('updated_at', { ascending: false })
            .then(({ data, error }) => {
                if (error) setError('Failed to load cases. Please refresh.')
                else setCases((data as CaseRow[] ?? []).filter(c => !isDraftCase(c)))
                setLoading(false)
            })
    }, [])

    const agents = useMemo(() => {
        const map = new Map<string, string>()
        cases.forEach(c => { if (c.created_by) map.set(c.created_by, c.profiles?.name || 'Unnamed agent') })
        return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    }, [cases])

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return cases.filter(c =>
            (!stageFilter || c.stage === stageFilter) &&
            (!typeFilter || c.case_type === typeFilter) &&
            (!agentFilter || c.created_by === agentFilter) &&
            (!q || (c.client_name ?? '').toLowerCase().includes(q)
                || (c.client_mobile ?? '').toLowerCase().includes(q)
                || (c.profiles?.name ?? '').toLowerCase().includes(q)),
        )
    }, [cases, stageFilter, typeFilter, agentFilter, search])

    const hasFilters = !!stageFilter || !!typeFilter || !!agentFilter || !!search

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                    <ClipboardList size={26} color="#8b5cf6" /> Insurance Cases
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                    {loading ? 'Loading…' : `${cases.length} case${cases.length !== 1 ? 's' : ''} across all agents`}
                </p>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search client, mobile, agent…"
                        className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100" />
                </div>
                <FilterSelect value={agentFilter} onChange={setAgentFilter} allLabel="All Agents"
                    options={agents.map(a => ({ value: a.id, label: a.name }))} />
                <FilterSelect value={stageFilter} onChange={setStageFilter} allLabel="All Stages"
                    options={STAGES.map(s => ({ value: s, label: s }))} />
                <FilterSelect value={typeFilter} onChange={setTypeFilter} allLabel="All Types"
                    options={CASE_TYPES.map(t => ({ value: t, label: t }))} />
                {hasFilters && (
                    <button onClick={() => { setStageFilter(''); setTypeFilter(''); setAgentFilter(''); setSearch('') }}
                        className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Clear filters</button>
                )}
            </div>

            {loading && (
                <div className="card p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">
                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    Loading cases…
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            )}

            {error && <div className="card p-6 flex items-center gap-3 text-red-600 text-sm"><AlertCircle size={18} />{error}</div>}

            {!loading && !error && filtered.length === 0 && (
                <div className="card p-12 text-center">
                    <ClipboardList size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 text-sm">No cases match the current filters.</p>
                </div>
            )}

            {!loading && !error && filtered.length > 0 && (
                <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-100 bg-slate-50">
                                    <Th>Agent</Th><Th>Client</Th><Th>Type</Th><Th>Stage</Th>
                                    <Th right>Loan</Th><Th right>Commission</Th><Th>Payout</Th><Th>Updated</Th><Th />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filtered.map(c => {
                                    const badge = STAGE_BADGE[c.stage] ?? DEFAULT_STAGE_BADGE
                                    const bucket = commissionBucket(c)
                                    const loan = caseLoanBase(c)
                                    return (
                                        <tr key={c.id}
                                            onClick={() => router.push(`/admin/insurance/cases/${c.id}`)}
                                            className="hover:bg-purple-50/40 cursor-pointer transition-colors">
                                            <td className="px-4 py-3 text-slate-600 font-medium">{c.profiles?.name ?? '—'}</td>
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-slate-800">{c.client_name || 'Unnamed'}</p>
                                                {c.client_mobile && <p className="text-xs text-slate-400 mt-0.5">{c.client_mobile}</p>}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600">{c.case_type}</td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap" style={{ color: badge.text, background: badge.bg }}>{c.stage}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-slate-700 font-medium">{loan ? formatCurrency(loan) : '—'}</td>
                                            <td className="px-4 py-3 text-right font-semibold text-emerald-700">{loan ? formatCurrency(caseCommission(c).agent) : '—'}</td>
                                            <td className="px-4 py-3">
                                                {bucket === 'closed_paid' && <PayoutBadge label="Paid" color="#16a34a" bg="#f0fdf4" />}
                                                {bucket === 'closed_unpaid' && <PayoutBadge label="Unpaid" color="#d97706" bg="#fffbeb" />}
                                                {bucket === 'open' && <span className="text-xs text-slate-400">—</span>}
                                                {bucket === null && <span className="text-xs text-slate-300">—</span>}
                                            </td>
                                            <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(c.updated_at)}</td>
                                            <td className="px-4 py-3"><ArrowRight size={15} className="text-slate-300" /></td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
                        {filtered.length} of {cases.length} case{cases.length !== 1 ? 's' : ''}
                    </div>
                </div>
            )}
        </div>
    )
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
    return <th className={`${right ? 'text-right' : 'text-left'} px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider`}>{children}</th>
}

function PayoutBadge({ label, color, bg }: { label: string; color: string; bg: string }) {
    return <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color, background: bg }}>{label}</span>
}

function FilterSelect({ value, onChange, allLabel, options }: {
    value: string; onChange: (v: string) => void; allLabel: string; options: { value: string; label: string }[]
}) {
    return (
        <div className="relative">
            <select value={value} onChange={e => onChange(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100">
                <option value="">{allLabel}</option>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
    )
}
