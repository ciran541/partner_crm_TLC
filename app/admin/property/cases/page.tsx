'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Building2, AlertCircle, ArrowRight, ChevronDown, Search,
} from 'lucide-react'
import { formatDate } from '@/lib/utils/formatDate'
import { useDebouncedValue } from '@/lib/insurance/usePagedCases'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import type { PropertyCase, PropertyCaseStatus, PropertyCaseType } from '@/lib/types/property'

const STATUS_CONFIG: Record<PropertyCaseStatus, { label: string; color: string; bg: string }> = {
    draft: { label: 'Draft', color: '#64748b', bg: '#f1f5f9' },
    submitted: { label: 'Submitted', color: '#3b82f6', bg: '#eff6ff' },
    paid: { label: 'Paid', color: '#16a34a', bg: '#f0fdf4' },
    rejected: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2' },
    opportunity_due: { label: 'Opportunity Due', color: '#ea580c', bg: '#fff7ed' },
}

const CASE_TYPE_LABELS: Record<PropertyCaseType, string> = {
    new_purchase: 'New Purchase',
    refinance: 'Refinance',
    decoupling: 'Decoupling',
    equity: 'Equity',
}

interface CaseRow extends Omit<PropertyCase, 'banks'> {
    banks?: { id: string; name: string } | null
    agent_name?: string | null
}

function StatusBadge({ status }: { status: PropertyCaseStatus }) {
    const cfg = STATUS_CONFIG[status]
    return (
        <span
            className="inline-flex items-center text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap"
            style={{ color: cfg.color, background: cfg.bg }}
        >
            {cfg.label}
        </span>
    )
}

export default function AdminPropertyCasesPage() {
    const router = useRouter()
    const [cases, setCases] = useState<CaseRow[]>([])
    const [totalCount, setTotalCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState('')
    const [typeFilter, setTypeFilter] = useState('')
    const [search, setSearch] = useState('')
    const query = useDebouncedValue(search)

    const params = new URLSearchParams({ limit: '50' })
    if (statusFilter) params.set('status', statusFilter)
    if (typeFilter) params.set('case_type', typeFilter)
    if (query.trim()) params.set('search', query.trim())
    const base = params.toString()
    const latest = useRef(base)
    useEffect(() => { latest.current = base }, [base])

    useEffect(() => {
        let alive = true
        fetch(`/api/property/cases?${base}`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error('load'))))
            .then(json => { if (alive) { setCases(json.data ?? []); setTotalCount(json.count ?? 0); setError(null) } })
            .catch(() => { if (alive) setError('Failed to load cases. Please refresh.') })
            .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
    }, [base])

    const loadMore = async () => {
        setLoadingMore(true)
        try {
            const r = await fetch(`/api/property/cases?${base}&page=${Math.floor(cases.length / 50) + 1}`)
            if (!r.ok) throw new Error()
            const json = await r.json()
            // The filters may have changed while this was loading.
            if (latest.current === base) {
                setCases(list => { const have = new Set(list.map(c => c.id)); return [...list, ...(json.data as CaseRow[]).filter(c => !have.has(c.id))] })
            }
        } catch { setError('Could not load more cases.') }
        setLoadingMore(false)
    }

    const filtered = cases

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <Building2 size={26} color="#8b5cf6" />
                        Cases
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {loading ? 'Loading…' : `${totalCount} case${totalCount !== 1 ? 's' : ''}${search || statusFilter || typeFilter ? ' match' : ' across all agents'}`}
                    </p>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search client, agent, address…"
                        className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors"
                    />
                </div>
                <div className="relative">
                    <select
                        value={statusFilter}
                        onChange={e => setStatusFilter(e.target.value)}
                        className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors"
                    >
                        <option value="">All Statuses</option>
                        {(Object.entries(STATUS_CONFIG) as [PropertyCaseStatus, { label: string }][]).map(([v, cfg]) => (
                            <option key={v} value={v}>{cfg.label}</option>
                        ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                <div className="relative">
                    <select
                        value={typeFilter}
                        onChange={e => setTypeFilter(e.target.value)}
                        className="appearance-none pl-3 pr-8 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors"
                    >
                        <option value="">All Types</option>
                        {(Object.entries(CASE_TYPE_LABELS) as [PropertyCaseType, string][]).map(([v, label]) => (
                            <option key={v} value={v}>{label}</option>
                        ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                {(statusFilter || typeFilter || search) && (
                    <button
                        onClick={() => { setStatusFilter(''); setTypeFilter(''); setSearch('') }}
                        className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 transition-colors"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {loading && (
                <div className="card p-8 flex items-center justify-center gap-3 text-slate-500 text-sm">
                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                    Loading cases…
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
            )}

            {error && (
                <div className="card p-6 flex items-center gap-3 text-red-600 text-sm">
                    <AlertCircle size={18} />{error}
                </div>
            )}

            {!loading && !error && filtered.length === 0 && (
                <div className="card p-12 text-center">
                    <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-slate-500 text-sm">No cases match the current filters.</p>
                </div>
            )}

            {!loading && !error && filtered.length > 0 && (
                <>
                    {/* Desktop table */}
                    <div className="hidden md:block card overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-100 bg-slate-50">
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Agent</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Bank</th>
                                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Loan</th>
                                        <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Commission</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Follow-up</th>
                                        <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {filtered.map(c => (
                                        <tr
                                            key={c.id}
                                            onClick={() => router.push(`/admin/property/cases/${c.id}`)}
                                            className="hover:bg-purple-50/40 cursor-pointer transition-colors"
                                        >
                                            <td className="px-4 py-3 text-slate-600 font-medium">{c.agent_name ?? '—'}</td>
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-slate-800">{c.client_name}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">{c.client_mobile}</p>
                                            </td>
                                            <td className="px-4 py-3 text-slate-600">{CASE_TYPE_LABELS[c.case_type]}</td>
                                            <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                                            <td className="px-4 py-3 text-slate-600">{(c as any).banks?.name ?? '—'}</td>
                                            <td className="px-4 py-3 text-right text-slate-700 font-medium">
                                                {c.outstanding_loan_amount ? formatCurrency(c.outstanding_loan_amount) : '—'}
                                            </td>
                                            <td className="px-4 py-3 text-right font-medium text-emerald-700">
                                                {c.agent_commission_amount ? formatCurrency(c.agent_commission_amount) : '—'}
                                            </td>
                                            <td className="px-4 py-3">
                                                {(c as any).followup_preference === 'self' && (
                                                    <>
                                                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#059669', background: '#ecfdf5', border: '1px solid #bbf7d0' }}>Agent</span>
                                                        {(c as any).follow_up_date && (
                                                            <p className="text-xs text-slate-400 mt-1">{formatDate((c as any).follow_up_date)}</p>
                                                        )}
                                                    </>
                                                )}
                                                {(c as any).followup_preference === 'tlc' && (
                                                    <>
                                                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: '#0284c7', background: '#e0f2fe', border: '1px solid #bae6fd' }}>TLC</span>
                                                        {(c as any).follow_up_date && (
                                                            <p className="text-xs text-slate-400 mt-1">{formatDate((c as any).follow_up_date)}</p>
                                                        )}
                                                    </>
                                                )}
                                                {!(c as any).followup_preference && (
                                                    <span className="text-slate-300 text-xs">—</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(c.created_at)}</td>
                                            <td className="px-4 py-3">
                                                <ArrowRight size={15} className="text-slate-300" />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
                            Showing {filtered.length} of {totalCount}
                        </div>
                    </div>

                    {/* Mobile card list */}
                    <div className="md:hidden space-y-3">
                        {filtered.map(c => (
                            <button
                                key={c.id}
                                onClick={() => router.push(`/admin/property/cases/${c.id}`)}
                                className="w-full card p-4 text-left"
                            >
                                <div className="flex items-start justify-between gap-2 mb-1">
                                    <p className="font-semibold text-slate-800 text-sm">{c.client_name}</p>
                                    <StatusBadge status={c.status} />
                                </div>
                                <p className="text-xs text-slate-500">{CASE_TYPE_LABELS[c.case_type]}</p>
                                <p className="text-xs text-purple-600 mt-0.5">Agent: {c.agent_name ?? '—'}</p>
                                <div className="flex items-center justify-between mt-2">
                                    <p className="text-xs text-slate-400">{formatDate(c.created_at)}</p>
                                    {c.agent_commission_amount && (
                                        <p className="text-xs font-semibold text-emerald-700">{formatCurrency(c.agent_commission_amount)}</p>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                    {filtered.length < totalCount && <button type="button" disabled={loadingMore} onClick={loadMore} className="w-full min-h-[44px] text-sm font-semibold text-[#0369a1]">{loadingMore ? 'Loading…' : `Load more (${totalCount - filtered.length} remaining)`}</button>}
                </>
            )}
        </div>
    )
}
