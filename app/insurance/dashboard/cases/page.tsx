'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Search, Briefcase, ChevronDown, ArrowRight, AlertCircle, TrendingUp, TrendingDown, Upload } from 'lucide-react'
import NewCaseModal from '@/components/insurance/cases/NewCaseModal'
import CaseImportModal from '@/components/insurance/cases/CaseImportModal'
import { PIPELINE_STAGES, INACTIVE_STAGE, stageLabel } from '@/lib/insurance/stages'
import FilterPills from '@/components/shared/FilterPills'
import EmptyState from '@/components/shared/EmptyState'
import Skeleton from '@/components/shared/Skeleton'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { usePagedCases, type CaseListRow } from '@/lib/insurance/usePagedCases'
import TrackBoard from '@/components/insurance/cases/TrackBoard'
import ClosedWonMonthly from '@/components/insurance/cases/ClosedWonMonthly'
import { todaySgt } from '@/lib/insurance/promotions'
// "Track" = the open pipeline as a drag-and-drop board. It's the default view.
// The other pills are single stages ("Touched Base" is labelled "Active").
// Inactive goes last: it's a parking area for past clients, not a pipeline step.
const TRACK = 'track'
const STATUS_PILL_OPTIONS = [
    { value: TRACK, label: 'Track' },
    ...PIPELINE_STAGES.filter(s => s !== INACTIVE_STAGE).map(s => ({ value: s, label: stageLabel(s) })),
    { value: INACTIVE_STAGE, label: INACTIVE_STAGE },
]

// Potential revenue ≈ loan size × 0.15%.
const REVENUE_RATE = 0.0015

const CLOSED_WON = 'Closed Won'
const CLOSED_LOST = 'Closed Lost'

// The loan figure comes from the server now (search_cases.loan_value), so the
// column and the revenue total are computed from ONE definition — the same one
// Earnings uses. This page previously had a local variant that ignored the
// Letter of Offer total on closed deals, so its revenue tile silently disagreed
// with Earnings on exactly the cases that had real money attached.
function caseLoanAmount(c: CaseListRow) {
    const v = c.loan_value ?? 0
    return v ? formatCurrency(v) : '—'
}

type DateMode = 'all' | 'range' | 'month'

/** Follow-up date colour: red when overdue, blue otherwise, faint when missing. */
function fuColor(fu: string | null | undefined, today: string): string {
    if (!fu) return '#cbd5e1'
    return fu.slice(0, 10) < today ? '#dc2626' : '#0369a1'
}

const inputStyle: React.CSSProperties = {
    padding: '8px 12px',
    fontSize: 13,
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: 'white',
    color: '#0f172a',
    outline: 'none',
}

// Suspense: useSearchParams (the ?new=1 hand-off) needs a boundary in the App Router.
export default function CasesPage() {
    return (
        <Suspense fallback={<Skeleton height={320} radius={14} />}>
            <CasesList />
        </Suspense>
    )
}

function CasesList() {
    const router = useRouter()
    const searchParams = useSearchParams()
    // ?new=1 (e.g. from the dashboard's "+ New Case") opens the form on arrival.
    const [newCaseOpen, setNewCaseOpen] = useState(() => searchParams.get('new') === '1')
    const [importOpen, setImportOpen] = useState(false)

    const [stageFilter, setStageFilter] = useState(TRACK)
    const isTrack = stageFilter === TRACK
    const isClosedWon = stageFilter === CLOSED_WON
    // Closed Won tab: which closings to list — 'YYYY-MM' (a month) or 'YYYY'
    // (whole year), SGT. Opens on this month.
    const currentMonth = todaySgt().slice(0, 7)
    const [closedMonth, setClosedMonth] = useState(currentMonth)
    const [agentFilter, setAgentFilter] = useState('all')
    const [search, setSearch] = useState('')
    const [agentList, setAgentList] = useState<{ id: string; name: string }[]>([])

    // Date filter — by range or by month, both off "account / case creation date".
    const [dateMode, setDateMode] = useState<DateMode>('all')
    const [fromDate, setFromDate] = useState('')
    const [toDate, setToDate] = useState('')
    const [month, setMonth] = useState('')

    const dateActive = dateMode !== 'all' && (dateMode === 'range' ? !!(fromDate || toDate) : !!month)

    // The server filters, pages and totals. `search` is passed raw — the hook
    // debounces it internally, so the input stays instant while the request waits
    // for you to stop typing.
    const {
        rows: cases,
        total,
        loanVolume,
        isAdmin,
        hasMore,
        loading,
        refreshing,
        loadingMore,
        error,
        loadMore,
    } = usePagedCases({
        search,
        stage: stageFilter,
        agent: agentFilter === 'all' ? undefined : agentFilter,
        from: dateMode === 'range' ? fromDate || undefined : undefined,
        to: dateMode === 'range' ? toDate || undefined : undefined,
        month: dateMode === 'month' ? month || undefined : undefined,
        // 'all' = every closed case (All time); otherwise a month or a year.
        closedMonth: isClosedWon && closedMonth !== 'all' ? closedMonth : undefined,
    }, { enabled: !isTrack })   // the board loads its own four columns

    // Admin-only: load the full agent roster for the agent filter. Gated on
    // isAdmin so the agent path never makes this call.
    useEffect(() => {
        if (!isAdmin) return
        let active = true
        fetch('/api/admin/get-profiles')
            .then(res => (res.ok ? res.json() : []))
            .then(profiles => {
                if (active && Array.isArray(profiles)) {
                    setAgentList(profiles.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
                }
            })
            .catch(() => { /* non-fatal: filter just won't populate */ })
        return () => { active = false }
    }, [isAdmin])

    // The date pickers used to take their floor from the earliest loaded case.
    // With paging we no longer hold the whole history, and guessing a floor from
    // the current page would move as you scroll — so only the ceiling (today) is
    // constrained now. The server applies the real filter either way.
    const { today, thisMonth } = useMemo(() => {
        const todayStr = new Date().toISOString().slice(0, 10)
        return { today: todayStr, thisMonth: todayStr.slice(0, 7) }
    }, [])

    const potentialRevenue = loanVolume * REVENUE_RATE
    const todayStr = todaySgt()

    const filterLabel = stageLabel(stageFilter)
    const hasFilters = stageFilter !== TRACK || agentFilter !== 'all' || !!search || dateActive

    const resetFilters = () => {
        setStageFilter(TRACK); setAgentFilter('all'); setSearch('')
        setDateMode('all'); setFromDate(''); setToDate(''); setMonth('')
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h1 className="ios-page-title">Cases</h1>
                        {!loading && !isTrack && (
                            <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: '#f1f5f9', color: '#64748b' }}>
                                {total}
                            </span>
                        )}
                    </div>
                    <p className="page-subtitle">Track your cases through the pipeline.</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                        onClick={() => setImportOpen(true)}
                        className="btn-lg"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 12, border: '1px solid #e2e8f0', background: 'white', color: '#052d4a', fontWeight: 600 }}
                    >
                        <Upload size={16} />
                        Mass Upload
                    </button>
                    <button
                        onClick={() => setNewCaseOpen(true)}
                        className="btn-primary btn-lg"
                    >
                        <Plus size={16} />
                        New Case
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <FilterPills
                    options={STATUS_PILL_OPTIONS}
                    value={stageFilter}
                    onChange={setStageFilter}
                    accentColor="#03a9e7"
                    scrollable
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {/* Search */}
                    <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
                        <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Client Name / Mobile / Email"
                            style={{ ...inputStyle, width: '100%', padding: '8px 12px 8px 34px' }}
                        />
                    </div>

                    {/* Date filter mode (list views only: the board is "what's open now") */}
                    {!isTrack && !isClosedWon && <div style={{ position: 'relative' }}>
                        <select
                            value={dateMode}
                            onChange={e => { setDateMode(e.target.value as DateMode); setFromDate(''); setToDate(''); setMonth('') }}
                            style={{ ...inputStyle, appearance: 'none', padding: '8px 32px 8px 12px', color: '#475569', cursor: 'pointer' }}
                        >
                            <option value="all">All time</option>
                            <option value="range">Date range</option>
                            <option value="month">By month</option>
                        </select>
                        <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                    </div>}

                    {!isTrack && !isClosedWon && dateMode === 'range' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="date" value={fromDate} max={toDate || today}
                                onChange={e => setFromDate(e.target.value)} style={inputStyle} aria-label="From date" />
                            <span style={{ color: '#94a3b8', fontSize: 13 }}>to</span>
                            <input type="date" value={toDate} min={fromDate || undefined} max={today}
                                onChange={e => setToDate(e.target.value)} style={inputStyle} aria-label="To date" />
                        </div>
                    )}
                    {!isTrack && !isClosedWon && dateMode === 'month' && (
                        <input type="month" value={month} max={thisMonth}
                            onChange={e => setMonth(e.target.value)} style={inputStyle} aria-label="Month" />
                    )}

                    {/* Admin agent filter */}
                    {isAdmin && (
                        <div style={{ position: 'relative' }}>
                            <select
                                value={agentFilter}
                                onChange={e => setAgentFilter(e.target.value)}
                                style={{ ...inputStyle, appearance: 'none', padding: '8px 32px 8px 12px', color: '#475569', cursor: 'pointer' }}
                            >
                                <option value="all">All Agents</option>
                                {agentList.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={13} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
                        </div>
                    )}

                    {hasFilters && (
                        <button
                            onClick={resetFilters}
                            className="on-navy-muted"
                            style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </div>

            {isTrack && (
                <TrackBoard search={search} agent={agentFilter === 'all' ? undefined : agentFilter} />
            )}

            {/* Closed Won: every month of every year in one grid; tap a month or year to list it. */}
            {isClosedWon && (
                <ClosedWonMonthly
                    scope={closedMonth}
                    currentMonth={currentMonth}
                    onScope={setClosedMonth}
                    loanVolume={loanVolume}
                    cases={total}
                    loading={loading || refreshing}
                    agent={agentFilter === 'all' ? undefined : agentFilter}
                />
            )}

            {/* Revenue banner — reflects the current filter. Open stages show
                Potential Revenue; Closed Lost shows Lost Revenue (the same 0.15%,
                on the deals that got away). Not shown for Inactive (parked past
                clients aren't pipeline revenue) or Closed Won (month view above). */}
            {!isTrack && !isClosedWon && !loading && !error && stageFilter !== INACTIVE_STAGE && (
                <div className="card" style={{
                    padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14,
                    background: stageFilter === CLOSED_LOST ? 'linear-gradient(to right, #fef2f2, #fff7f7)' : 'linear-gradient(to right, #ecfeff, #f0f9ff)',
                }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: stageFilter === CLOSED_LOST ? '#ef4444' : '#03a9e7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {stageFilter === CLOSED_LOST ? <TrendingDown size={20} color="white" /> : <TrendingUp size={20} color="white" />}
                    </div>
                    <div>
                        <p style={{ fontSize: 11, fontWeight: 700, color: stageFilter === CLOSED_LOST ? '#b91c1c' : '#0369a1', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {stageFilter === CLOSED_LOST ? 'Lost Revenue' : `Potential Revenue · ${filterLabel}`}
                        </p>
                        <p style={{ fontSize: 24, fontWeight: 800, color: '#052d4a', lineHeight: 1.15 }}>
                            {formatCurrency(potentialRevenue)}
                        </p>
                        {/* Both figures come from the server and cover every case
                            matching the filter — not just the rows loaded so far. */}
                        <p style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                            0.15% of {formatCurrency(loanVolume)} loan volume · {total} case{total !== 1 ? 's' : ''}
                        </p>
                    </div>
                </div>
            )}

            {!isTrack && loading && (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={48} radius={10} />)}
                </div>
            )}

            {!isTrack && error && !loading && (
                <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10, color: '#dc2626', fontSize: 14 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    {error}
                </div>
            )}

            {!isTrack && !loading && !error && cases.length === 0 && (
                <EmptyState
                    icon={Briefcase}
                    iconColor="#03a9e7"
                    title={isClosedWon ? 'Nothing closed in this period' : hasFilters ? 'No cases match filters' : 'No cases yet'}
                    description={isClosedWon
                        ? 'Tap another month or year in the grid above.'
                        : hasFilters
                            ? 'Try adjusting your filters to see more results.'
                            : 'Create your first case to start tracking your pipeline.'}
                    action={hasFilters || isClosedWon ? undefined : { label: 'New Case', onClick: () => setNewCaseOpen(true) }}
                />
            )}

            {/* `refreshing` means a new query is loading OVER existing rows. Dim
                rather than blank so there is no spinner flash or layout jump. */}
            {!isTrack && !loading && !error && cases.length > 0 && (
                <div style={{
                    display: 'flex', flexDirection: 'column', gap: 20,
                    opacity: refreshing ? 0.55 : 1,
                    transition: 'opacity 0.15s',
                }}>
                    {/* Desktop table */}
                    <div className="hidden md:block card" style={{ overflow: 'hidden' }}>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                        <th className="table-th">Client</th>
                                        {isAdmin && <th className="table-th">Agent</th>}
                                        <th className="table-th">Type</th>
                                        <th className="table-th" style={{ textAlign: 'right' }}>Loan Amount</th>
                                        <th className="table-th">Banker</th>
                                        <th className="table-th">{isClosedWon ? 'Closed / Follow-Up' : 'Input / Follow-Up'}</th>
                                        <th className="table-th">Remark</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cases.map(c => (
                                        <tr
                                            key={c.id}
                                            onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = '#f8fafc')}
                                            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = '')}
                                        >
                                            <td className="table-td">
                                                <p style={{ fontWeight: 600, color: '#0f172a' }}>
                                                    {c.client_name || <span style={{ color: '#94a3b8', fontStyle: 'italic', fontWeight: 400 }}>Unnamed</span>}
                                                    {c.parent_case_id && (
                                                    <span title="Revisit of an earlier closed case" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#0369a1', background: '#e0f2fe', padding: '1px 6px', borderRadius: 9999, verticalAlign: 'middle' }}>
                                                        ↻ Returning client
                                                    </span>
                                                )}
                                                </p>
                                                {c.client_mobile && <p style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{c.client_mobile}</p>}
                                                {c.client_email && <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 1, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.client_email}</p>}
                                            </td>
                                            {isAdmin && (
                                                <td className="table-td" style={{ color: '#475569' }}>{c.profiles?.name || 'Unknown Agent'}</td>
                                            )}
                                            <td className="table-td" style={{ color: '#475569' }}>{c.case_type}</td>
                                            <td className="table-td" style={{ textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{caseLoanAmount(c)}</td>
                                            <td className="table-td">
                                                {c.referred_bankers && c.referred_bankers.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                        {c.referred_bankers.map((b, i) => (
                                                            <span key={i} style={{ fontSize: 12, color: '#0f172a' }}>
                                                                {b.name} <span style={{ color: '#94a3b8' }}>· {b.bank}</span>
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                                            </td>
                                            <td className="table-td" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                                <div style={{ color: '#475569' }}>
                                                    {isClosedWon && c.closed_on ? `Closed: ${formatDate(c.closed_on)}` : `In: ${formatDate(c.created_at)}`}
                                                </div>
                                                <div style={{ color: fuColor(c.follow_up_date, todayStr), marginTop: 2 }}>
                                                    FU: {c.follow_up_date ? formatDate(c.follow_up_date) : '—'}
                                                </div>
                                            </td>
                                            <td className="table-td" style={{ fontSize: 12, color: '#475569', maxWidth: 220 }}>
                                                {c.follow_up_remark
                                                    ? <span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.follow_up_remark}</span>
                                                    : <span style={{ color: '#cbd5e1' }}>—</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12, color: '#94a3b8' }}>
                            Showing {cases.length} of {total} case{total !== 1 ? 's' : ''}
                        </div>
                    </div>

                    {/* Mobile card list */}
                    <div className="md:hidden flex flex-col gap-2.5">
                        {cases.map(c => (
                            <button
                                key={c.id}
                                onClick={() => router.push(`/insurance/dashboard/cases/${c.id}`)}
                                className="card"
                                style={{
                                    padding: '18px 20px', textAlign: 'left',
                                    display: 'flex', alignItems: 'flex-start', gap: 14,
                                    width: '100%', background: 'none', cursor: 'pointer',
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
                                        <p style={{ fontWeight: 700, color: '#0f172a', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {c.client_name || 'Unnamed'}
                                        </p>
                                    </div>
                                    <p style={{ fontSize: 13, color: '#64748b', marginBottom: 8 }}>
                                        {c.case_type}{c.parent_case_id ? ' · ↻ Returning client' : ''}
                                    </p>
                                    {(c.client_mobile || c.client_email) && (
                                        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {[c.client_mobile, c.client_email].filter(Boolean).join(' · ')}
                                        </p>
                                    )}
                                    {c.follow_up_remark && <p style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>{c.follow_up_remark}</p>}
                                    {isAdmin && c.profiles?.name && (
                                        <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Agent: {c.profiles.name}</p>
                                    )}
                                    {c.referred_bankers && c.referred_bankers.length > 0 && (
                                        <p style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
                                            Banker: {c.referred_bankers.map(b => `${b.name} (${b.bank})`).join(', ')}
                                        </p>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 12, color: '#94a3b8' }}>
                                            {isClosedWon && c.closed_on ? `Closed: ${formatDate(c.closed_on)}` : `In: ${formatDate(c.created_at)}`}{c.follow_up_date ? ` · FU: ${formatDate(c.follow_up_date)}` : ''}
                                        </span>
                                        <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{caseLoanAmount(c)}</span>
                                    </div>
                                </div>
                                <ArrowRight size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 4 }} />
                            </button>
                        ))}
                    </div>

                    {/* Appends the next page, so scroll position is preserved. */}
                    {hasMore && (
                        <button
                            onClick={loadMore}
                            disabled={loadingMore}
                            className="card"
                            style={{
                                padding: '12px 20px', width: '100%', cursor: loadingMore ? 'default' : 'pointer',
                                background: 'none', border: '1px solid #e2e8f0',
                                fontSize: 13, fontWeight: 600, color: '#0369a1',
                            }}
                        >
                            {loadingMore ? 'Loading…' : `Load more (${total - cases.length} remaining)`}
                        </button>
                    )}
                </div>
            )}
            {newCaseOpen && (
                <NewCaseModal
                    onClose={() => setNewCaseOpen(false)}
                    onCreated={id => { setNewCaseOpen(false); router.push(`/insurance/dashboard/cases/${id}`) }}
                />
            )}
            {importOpen && <CaseImportModal onClose={() => setImportOpen(false)} />}
        </div>
    )
}
