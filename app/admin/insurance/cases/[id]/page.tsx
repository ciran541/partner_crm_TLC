'use client'

import { ReactNode, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
    ArrowLeft, AlertCircle, User, FileText,
    CheckCircle2, TrendingUp, Activity, Briefcase, CalendarClock, DollarSign,
} from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { supabase } from '@/lib/supabaseClient'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { calculateCommission } from '@/lib/property/commission'
import { caseLoanBase, caseCommission } from '@/lib/insurance/commission'
import { CLOSED_LOAN_LABELS } from '@/lib/insurance/closedWon'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import {
    getPurchaseWorkflow, getRefinancingWorkflow, getDecoupleWorkflow, getEquityLoanWorkflow,
} from '@/lib/types/workflow'
import PurchaseOverview from '@/components/insurance/workflow/PurchaseOverview'
import RefiOverview from '@/components/insurance/workflow/RefiOverview'
import DecoupleOverview from '@/components/insurance/workflow/DecoupleOverview'
import EquityLoanOverview from '@/components/insurance/workflow/EquityLoanOverview'
import { stageBadge } from '@/lib/insurance/stages'
import CaseJourney from '@/components/insurance/cases/CaseJourney'
import CorrectionModal from '@/components/insurance/cases/CorrectionModal'
import CorrectionNotice from '@/components/insurance/cases/CorrectionNotice'
import type { Case } from '@/lib/types'

type CaseRow = Case & { profiles?: { id: string; name: string } | null }

interface ActivityLog {
    id: string; action: string; old_value: unknown; new_value: unknown; actor_name: string; created_at: string
}
const ACTION_LABEL: Record<string, string> = {
    stage_change: 'Stage changed',
    commission_status_change: 'Commission status',
    correction: 'Correction',
}

// Activity line text. Corrections store an object (stage, fee, reason) rather than a single value.
function describeLog(l: ActivityLog): React.ReactNode {
    if (l.action === 'correction' && l.new_value && typeof l.new_value === 'object') {
        const v = l.new_value as { mode?: string; fee?: number; reason?: string; stage?: string }
        return (
            <span className="font-normal text-slate-600">
                {v.mode === 'reopen' ? 'sent back to agent' : 'fixed by TLC'}{v.fee ? ` · $${v.fee} fee` : ' · fee waived'}{v.reason ? ` · "${v.reason}"` : ''}
            </span>
        )
    }
    return (
        <>
            <span className="text-slate-500 font-normal">{String(l.old_value ?? '—')}</span> → <span className="font-semibold">{String(l.new_value ?? '—')}</span>
        </>
    )
}

const money = (n?: number | null) => (n != null ? formatCurrency(n) : '—')

// ── insurance-style presentational helpers (mirrors the case Overview) ──
function Card({ title, icon, children, action }: { title: string; icon: ReactNode; children: ReactNode; action?: ReactNode }) {
    return (
        <div className="card p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-[#03a9e7]">{icon}</div>
                    <h3 className="font-bold text-[#052d4a]">{title}</h3>
                </div>
                {action}
            </div>
            {children}
        </div>
    )
}

function Field({ label, value }: { label: string; value?: string | null }) {
    return (
        <div>
            <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</dt>
            <dd className="text-sm font-semibold mt-0.5 break-words text-slate-800">{value || '—'}</dd>
        </div>
    )
}

export default function AdminInsuranceCaseDetail() {
    const router = useRouter()
    const params = useParams()
    const id = params?.id as string
    const [c, setCase] = useState<CaseRow | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [logs, setLogs] = useState<ActivityLog[]>([])
    const [correcting, setCorrecting] = useState(false)

    const loadLogs = () => {
        fetch(`/api/admin/insurance/case-activity?caseId=${id}`)
            .then(r => (r.ok ? r.json() : []))
            .then(d => { if (Array.isArray(d)) setLogs(d) })
            .catch(() => {})
    }

    useEffect(() => {
        supabase.from('cases').select('*, profiles ( id, name )').eq('id', id).single()
            .then(({ data, error }) => {
                if (error || !data) setError('Case not found.')
                else setCase(data as CaseRow)
                setLoading(false)
            })
        loadLogs()
    }, [id])

    const togglePaid = async () => {
        if (!c) return
        const next = c.commission_status === 'paid' ? 'unpaid' : 'paid'
        setSaving(true)
        try {
            const res = await fetch('/api/admin/update-case', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: c.id, updates: { commission_status: next } }),
            })
            if (!res.ok) throw new Error('Failed')
            setCase({ ...c, commission_status: next })
            loadLogs()
        } catch {
            setError('Failed to update commission status.')
        } finally {
            setSaving(false)
        }
    }

    const openDoc = async (path: string) => {
        const { data } = await supabase.storage.from('insurance-documents').createSignedUrl(path, 120)
        if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    }

    // Same per-case-type workflow shape the agent's own Overview tab renders from —
    // gives the admin console byte-for-byte the same depth (financing options,
    // stamp duty, selected package…), just read-only.
    const workflowData = useMemo(() => {
        if (!c) return null
        switch (c.case_type) {
            case 'Purchase': return { kind: 'Purchase' as const, wf: getPurchaseWorkflow(c.workflow_data) }
            case 'Decouple': return { kind: 'Decouple' as const, wf: getDecoupleWorkflow(c.workflow_data) }
            case 'Equity Loan': return { kind: 'Equity Loan' as const, wf: getEquityLoanWorkflow(c.workflow_data) }
            default: return { kind: 'Refinancing' as const, wf: getRefinancingWorkflow(c.workflow_data) }
        }
    }, [c])

    if (loading) return <div className="flex items-center justify-center py-20"><Spinner size="md" color="#03a9e7" label="Loading case…" /></div>
    if (error && !c) return <div className="card p-6 flex items-center gap-3 text-red-600 text-sm"><AlertCircle size={18} />{error}</div>
    if (!c) return null

    const badge = stageBadge(c.stage)
    const loan = caseLoanBase(c)
    const comm = caseCommission(c)
    const cwd = c.closed_won_data
    const outstanding = cwd?.combined_outstanding
    const next = outstanding != null ? calculateCommission(outstanding) : null
    const isClosedWon = c.stage === 'Closed Won'
    const paid = c.commission_status === 'paid'
    const noop = () => {}

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            {/* Header */}
            <div>
                <button onClick={() => router.push('/admin/insurance/cases')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3">
                    <ArrowLeft size={14} /> Back to Insurance Cases
                </button>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="ios-page-title">{c.client_name || 'Unnamed case'}</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            {c.case_type} · Created {formatDate(c.created_at)}
                            {c.profiles?.name && <span className="ml-2 text-[#03a9e7] font-medium">by {c.profiles.name}</span>}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold" style={{ color: badge.text, background: badge.bg }}>{c.stage}</span>
                        {isClosedWon && !paid && (
                            <button type="button" onClick={() => setCorrecting(true)}
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50 transition-colors">
                                Correct this case
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <CorrectionNotice data={c} />
            {correcting && (
                <CorrectionModal
                    caseData={c}
                    onClose={() => setCorrecting(false)}
                    onDone={updated => { setCase({ ...c, ...updated }); setCorrecting(false); loadLogs() }}
                />
            )}

            {/* Commission — back-check & confirm */}
            {loan > 0 && (
                <Card title="Commission" icon={<DollarSign size={16} />}
                    action={isClosedWon ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={paid ? { color: '#16a34a', background: '#dcfce7' } : { color: '#d97706', background: '#fef3c7' }}>{paid ? 'Paid' : 'Unpaid'}</span>
                    ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-[#0369a1]">Potential</span>
                    )}>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Gross (0.15%)</p>
                            <p className="text-lg font-extrabold text-[#052d4a] mt-0.5">{money(comm.gross)}</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{comm.correctionFee > 0 ? 'Agent payout' : 'Agent (90%)'}</p>
                            <p className="text-lg font-extrabold text-emerald-600 mt-0.5">{money(comm.agent)}</p>
                            {comm.correctionFee > 0 && <p className="text-[11px] font-semibold text-red-600">after −{money(comm.correctionFee)} correction fee</p>}
                        </div>
                        <div>
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">TLC (10%)</p>
                            <p className="text-lg font-extrabold text-slate-500 mt-0.5">{money(comm.tlc)}</p>
                        </div>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-2">Based on {money(loan)} loan{isClosedWon ? '' : ' — payout can be confirmed once Closed Won'}.</p>
                    {isClosedWon && (
                        <button onClick={togglePaid} disabled={saving}
                            className="mt-3 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                            style={paid ? { background: '#fff', color: '#64748b', border: '1px solid #e2e8f0' } : { background: '#059669', color: 'white' }}>
                            {saving ? <Spinner size="sm" color={paid ? '#64748b' : 'white'} /> : paid ? 'Mark as unpaid' : <><CheckCircle2 size={15} /> Confirm commission paid</>}
                        </button>
                    )}
                </Card>
            )}

            {/* Full case workflow snapshot — identical depth to the agent's own Overview tab */}
            {workflowData?.kind === 'Purchase' && (
                <PurchaseOverview workflow={workflowData.wf} stage={c.stage} followUpDate={c.follow_up_date} onOpenWorkflow={noop} readOnly />
            )}
            {workflowData?.kind === 'Decouple' && (
                <DecoupleOverview workflow={workflowData.wf} stage={c.stage} followUpDate={c.follow_up_date} onOpenWorkflow={noop} readOnly />
            )}
            {workflowData?.kind === 'Equity Loan' && (
                <EquityLoanOverview workflow={workflowData.wf} stage={c.stage} followUpDate={c.follow_up_date} onOpenWorkflow={noop} readOnly />
            )}
            {workflowData?.kind === 'Refinancing' && (
                <RefiOverview workflow={workflowData.wf} stage={c.stage} followUpDate={c.follow_up_date} onOpenWorkflow={noop} readOnly />
            )}

            {/* Client journey across refinancing cycles (renders nothing if unlinked) */}
            <CaseJourney caseId={c.id} parentId={c.parent_case_id} hrefFor={cid => `/admin/insurance/cases/${cid}`} />

            {/* Client */}
            <Card title="Client Information" icon={<User size={16} />}>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                    <Field label="Full Name" value={c.client_name} />
                    <Field label="Mobile" value={c.client_mobile} />
                    <Field label="Email" value={c.client_email} />
                </div>
            </Card>

            {/* Closed package — final terms captured at Closed Won (may differ from the workflow snapshot above) */}
            {isClosedWon && cwd?.loans && cwd.loans.length > 0 && (
                <Card title="Closed Package" icon={<CheckCircle2 size={16} />}>
                    {c.closed_package_details && <p className="text-xs text-slate-500 -mt-2 mb-3">{c.closed_package_details}</p>}
                    <div className="space-y-2">
                        {cwd.loans.map((l, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100">
                                <span className="text-sm font-medium text-slate-600">{CLOSED_LOAN_LABELS[l.kind]}</span>
                                <span className="text-sm font-bold text-[#052d4a]">{money(l.amount)} · {l.tenure} yrs</span>
                            </div>
                        ))}
                    </div>
                    {cwd.package?.schedule && cwd.package.schedule.length > 0 && (
                        <div className="mt-3">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                                Rate Schedule{cwd.package.lockin_years ? ` · ${cwd.package.lockin_years}-yr lock-in` : ''}
                            </p>
                            <div className="rounded-lg border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                                {cwd.package.schedule.map((e, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-2 text-xs bg-white">
                                        <span className="font-medium text-slate-500">{e.thereafter ? 'Thereafter' : `Year ${e.year}`}</span>
                                        <span className="text-slate-700">{formatRateEntry(e).split(': ').slice(1).join(': ')}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {(c.subsidy_provided || c.clawback_end_date) && (
                        <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-3 pt-3 border-t border-slate-100">
                            <Field label="Subsidy Provided" value={c.subsidy_provided} />
                            <Field label="Clawback End" value={c.clawback_end_date ? formatDate(c.clawback_end_date) : null} />
                        </div>
                    )}
                    {cwd.lo_documents && cwd.lo_documents.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Letter of Offer</p>
                            {cwd.lo_documents.map((d, i) => (
                                <button key={i} onClick={() => openDoc(d.path)}
                                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border border-slate-200 hover:border-[#03a9e7] hover:bg-sky-50/50 transition-colors text-left">
                                    <FileText size={16} className="text-slate-400 shrink-0" />
                                    <span className="text-sm font-medium text-slate-700 truncate">{d.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </Card>
            )}

            {/* Bankers */}
            <Card title="Referred Banker(s)" icon={<Briefcase size={16} />}>
                {c.referred_bankers && c.referred_bankers.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {c.referred_bankers.map((b, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-700 border border-sky-100 text-xs font-medium">
                                {b.name} <span className="text-sky-400">·</span> {b.bank}
                            </span>
                        ))}
                    </div>
                ) : <p className="text-sm text-slate-400">No bankers assigned.</p>}
            </Card>

            {/* Next-cycle projection */}
            {isClosedWon && outstanding != null && next && (
                <Card title="Next-Cycle Projection" icon={<TrendingUp size={16} />}>
                    <p className="text-[11px] text-slate-400 -mt-2 mb-3">Estimated at the end of the lock-in period, based on the combined post-lock-in outstanding balance.</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div className="bg-slate-50 rounded-lg p-3"><p className="text-[11px] text-slate-400">Combined outstanding</p><p className="text-sm font-bold text-[#052d4a] mt-0.5">{money(outstanding)}</p></div>
                        <div className="bg-slate-50 rounded-lg p-3"><p className="text-[11px] text-slate-400">Gross</p><p className="text-sm font-bold text-[#052d4a] mt-0.5">{money(next.gross)}</p></div>
                        <div className="bg-sky-50/70 rounded-lg p-3"><p className="text-[11px] text-slate-400">Agent income</p><p className="text-sm font-bold text-[#03a9e7] mt-0.5">{money(next.agent)}</p></div>
                    </div>
                </Card>
            )}

            {/* Activity */}
            <Card title="Activity" icon={<Activity size={16} />}>
                {logs.length === 0 ? (
                    <p className="text-sm text-slate-400">No admin activity recorded yet.</p>
                ) : (
                    <div className="space-y-3">
                        {logs.map(l => (
                            <div key={l.id} className="flex gap-3">
                                <div className="flex flex-col items-center">
                                    <div className="w-7 h-7 rounded-full bg-sky-50 flex items-center justify-center shrink-0"><CalendarClock size={13} className="text-[#03a9e7]" /></div>
                                    <div className="w-px flex-1 bg-slate-100 mt-1" />
                                </div>
                                <div className="pb-4 min-w-0">
                                    <p className="text-sm font-medium text-slate-700">
                                        {ACTION_LABEL[l.action] ?? l.action}: {describeLog(l)}
                                    </p>
                                    <p className="text-xs text-slate-400 mt-0.5">{l.actor_name} · {formatDate(l.created_at)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {error && c && (
                <div className="card p-3 flex items-center gap-2 text-red-600 text-sm"><AlertCircle size={15} />{error}</div>
            )}
        </div>
    )
}
