'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
    ArrowLeft, AlertCircle, Check, User, Phone, Mail,
    MapPin, Building2, Percent, Calendar, BadgeCheck,
    FileText, Clock, DollarSign, TrendingUp, Activity,
    ChevronDown, Save,
} from 'lucide-react'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import type {
    PropertyCase, PropertyCaseDocument, PropertyCaseActivityLog,
    PropertyCaseStatus, PropertyCaseType, PropertyCommissionStatus,
} from '@/lib/types/property'

const STATUS_CONFIG: Record<PropertyCaseStatus, { label: string; color: string; bg: string }> = {
    draft: { label: 'Draft', color: '#64748b', bg: '#f1f5f9' },
    submitted: { label: 'Submitted', color: '#3b82f6', bg: '#eff6ff' },
    under_review: { label: 'Under Review', color: '#d97706', bg: '#fffbeb' },
    verified: { label: 'Verified', color: '#059669', bg: '#ecfdf5' },
    paid: { label: 'Paid', color: '#16a34a', bg: '#f0fdf4' },
    rejected: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2' },
    on_hold: { label: 'On Hold', color: '#7c3aed', bg: '#f5f3ff' },
    opportunity_due: { label: 'Opportunity Due', color: '#ea580c', bg: '#fff7ed' },
}

const CASE_TYPE_LABELS: Record<PropertyCaseType, string> = {
    new_purchase: 'New Purchase',
    refinance: 'Refinance',
    decoupling: 'Decoupling',
    equity: 'Equity',
}

interface CaseDetail extends Omit<PropertyCase, 'banks'> {
    banks?: { id: string; name: string } | null
    documents: PropertyCaseDocument[]
    activity_logs: PropertyCaseActivityLog[]
    agent_name?: string | null
}

interface AdminFormState {
    status: PropertyCaseStatus
    lockin_confirmed_date: string
    commission_status: PropertyCommissionStatus
    gross_commission_amount: string
    agent_commission_amount: string
    tlc_commission_amount: string
    notes: string
    recurring_converted: boolean
}

function InfoRow({ label, value, icon: Icon }: { label: string; value?: string | null; icon: React.ElementType }) {
    return (
        <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0 mt-0.5">
                <Icon size={15} color="#64748b" />
            </div>
            <div className="min-w-0">
                <p className="text-xs text-slate-400 font-medium">{label}</p>
                <p className="text-sm text-slate-800 font-medium">{value || '—'}</p>
            </div>
        </div>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="card p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
            {children}
        </div>
    )
}

function formatAction(action: string) {
    return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function AdminDetailContent() {
    const params = useParams()
    const router = useRouter()
    const caseId = params.id as string

    const [caseData, setCaseData] = useState<CaseDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [form, setForm] = useState<AdminFormState>({
        status: 'submitted',
        lockin_confirmed_date: '',
        commission_status: 'pending',
        gross_commission_amount: '',
        agent_commission_amount: '',
        tlc_commission_amount: '',
        notes: '',
        recurring_converted: false,
    })
    const [saving, setSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    useEffect(() => {
        fetch(`/api/property/cases/${caseId}`)
            .then(r => {
                if (!r.ok) throw new Error(r.status === 403 ? 'Access denied.' : 'Case not found.')
                return r.json()
            })
            .then(json => {
                const data = json.data as CaseDetail
                setCaseData(data)
                setForm({
                    status: data.status,
                    lockin_confirmed_date: data.lockin_confirmed_date ?? '',
                    commission_status: data.commission_status,
                    gross_commission_amount: data.gross_commission_amount != null ? String(data.gross_commission_amount) : '',
                    agent_commission_amount: data.agent_commission_amount != null ? String(data.agent_commission_amount) : '',
                    tlc_commission_amount: data.tlc_commission_amount != null ? String(data.tlc_commission_amount) : '',
                    notes: data.notes ?? '',
                    recurring_converted: data.recurring_converted ?? false,
                })
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [caseId])

    function setField<K extends keyof AdminFormState>(key: K, value: AdminFormState[K]) {
        setForm(f => ({ ...f, [key]: value }))
    }

    async function handleSave() {
        if (!caseData) return
        setSaving(true)
        setSaveError(null)
        setSaveSuccess(false)

        const payload: Record<string, unknown> = {
            id: caseId,
            status: form.status,
            commission_status: form.commission_status,
            gross_commission_amount: form.gross_commission_amount ? parseFloat(form.gross_commission_amount) : null,
            agent_commission_amount: form.agent_commission_amount ? parseFloat(form.agent_commission_amount) : null,
            tlc_commission_amount: form.tlc_commission_amount ? parseFloat(form.tlc_commission_amount) : null,
            notes: form.notes.trim() || null,
            lockin_confirmed_date: form.lockin_confirmed_date || null,
            recurring_converted: form.recurring_converted,
        }

        try {
            const res = await fetch('/api/admin/property/update-case', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })
            const json = await res.json()
            if (!res.ok) {
                setSaveError(json.error ?? 'Failed to save changes.')
                return
            }
            // Refresh case data
            const refreshed = await fetch(`/api/property/cases/${caseId}`).then(r => r.json())
            if (refreshed.data) setCaseData(refreshed.data)
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 4000)
        } catch {
            setSaveError('An unexpected error occurred.')
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="card p-12 flex items-center justify-center gap-3 text-slate-500 text-sm">
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                Loading case…
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        )
    }

    if (error) {
        return (
            <div className="card p-8 flex flex-col items-center gap-3 text-center">
                <AlertCircle size={28} className="text-red-400" />
                <p className="text-slate-600 text-sm">{error}</p>
                <button onClick={() => router.push('/admin/property/cases')} className="btn-outline text-sm px-4 py-2">
                    Back to Cases
                </button>
            </div>
        )
    }

    if (!caseData) return null

    const statusCfg = STATUS_CONFIG[caseData.status]
    const hasCommission = caseData.gross_commission_amount != null
    const hasProjection = caseData.projected_gross_commission != null

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <button
                    onClick={() => router.push('/admin/property/cases')}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3"
                >
                    <ArrowLeft size={14} />
                    Back to Property Cases
                </button>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-[#052d4a]">{caseData.client_name}</h1>
                        <p className="text-sm text-slate-500 mt-1">
                            {CASE_TYPE_LABELS[caseData.case_type]} · Submitted {formatDate(caseData.created_at)}
                            {caseData.agent_name && <span className="ml-2 text-purple-600">by {caseData.agent_name}</span>}
                        </p>
                    </div>
                    <span
                        className="text-sm font-semibold px-3 py-1.5 rounded-full"
                        style={{ color: statusCfg.color, background: statusCfg.bg }}
                    >
                        {statusCfg.label}
                    </span>
                </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                {/* Left: Case Info */}
                <div className="lg:col-span-2 space-y-5">
                    {/* Commission */}
                    {hasCommission && (
                        <div className="card p-6" style={{ background: 'linear-gradient(135deg, #059669 0%, #065f46 100%)' }}>
                            <h3 className="text-xs font-semibold text-emerald-100 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <DollarSign size={13} />Commission
                            </h3>
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <p className="text-xs text-emerald-200">Gross</p>
                                    <p className="text-xl font-bold text-white mt-0.5">{formatCurrency(caseData.gross_commission_amount)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-emerald-200">Agent Share</p>
                                    <p className="text-xl font-bold text-white mt-0.5">{formatCurrency(caseData.agent_commission_amount)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-emerald-200">TLC Share</p>
                                    <p className="text-lg font-bold text-white/80 mt-0.5">{formatCurrency(caseData.tlc_commission_amount)}</p>
                                </div>
                            </div>
                            <div className="mt-3 pt-3 border-t border-white/20 text-xs text-emerald-200">
                                Commission Status: <span className="text-white font-semibold capitalize">{caseData.commission_status}</span>
                            </div>
                        </div>
                    )}

                    {/* Client */}
                    <Section title="Client Information">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <InfoRow icon={User} label="Full Name" value={caseData.client_name} />
                            <InfoRow icon={Phone} label="Mobile" value={caseData.client_mobile} />
                            {caseData.client_email && <InfoRow icon={Mail} label="Email" value={caseData.client_email} />}
                            <InfoRow icon={MapPin} label="Property Address" value={caseData.property_address} />
                        </div>
                    </Section>

                    {/* Mortgage */}
                    <Section title="Mortgage Details">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <InfoRow icon={Building2} label="Bank" value={caseData.banks?.name} />
                            <InfoRow icon={Percent} label="Interest Rate" value={caseData.interest_rate != null ? `${caseData.interest_rate}%` : null} />
                            <InfoRow icon={Calendar} label="Balance Tenure" value={caseData.balance_tenure_months != null ? `${caseData.balance_tenure_months} months` : null} />
                            <InfoRow icon={DollarSign} label="Outstanding Loan" value={caseData.outstanding_loan_amount ? formatCurrency(caseData.outstanding_loan_amount) : null} />
                            {caseData.subsidy_amount != null && <InfoRow icon={DollarSign} label="Subsidy" value={formatCurrency(caseData.subsidy_amount)} />}
                        </div>
                    </Section>

                    {/* Lock-in + Projection */}
                    <Section title="Lock-in & Projection">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <InfoRow icon={BadgeCheck} label="Confirmed Lock-in Date" value={caseData.lockin_confirmed_date ? formatDate(caseData.lockin_confirmed_date) : null} />
                        </div>
                        {hasProjection && (
                            <div className="mt-2 pt-4 border-t border-slate-100">
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                    <TrendingUp size={12} />Projected at Lock-in Maturity
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {[
                                        { label: 'Remaining Balance', value: caseData.projected_remaining_balance },
                                        { label: 'Gross Commission', value: caseData.projected_gross_commission },
                                        { label: 'Agent Income', value: caseData.projected_agent_income },
                                        { label: 'TLC Income', value: caseData.projected_tlc_income },
                                    ].map(({ label, value }) => (
                                        <div key={label} className="bg-slate-50 rounded-lg p-3">
                                            <p className="text-xs text-slate-400">{label}</p>
                                            <p className="text-sm font-semibold text-slate-700 mt-0.5">{value ? formatCurrency(value) : '—'}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Section>

                    {/* Documents */}
                    <Section title="Documents">
                        {caseData.documents.length === 0 ? (
                            <p className="text-sm text-slate-400">No documents attached.</p>
                        ) : (
                            <div className="space-y-2">
                                {caseData.documents.map(doc => (
                                    <a
                                        key={doc.id}
                                        href={doc.file_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-purple-400 hover:bg-purple-50 transition-colors"
                                    >
                                        <FileText size={16} className="text-slate-400 shrink-0" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-slate-700 truncate">{doc.file_name}</p>
                                            <p className="text-xs text-slate-400">{formatDate(doc.created_at)}</p>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        )}
                    </Section>

                    {/* Activity Log */}
                    <Section title="Activity Log">
                        {caseData.activity_logs.length === 0 ? (
                            <p className="text-sm text-slate-400">No activity recorded.</p>
                        ) : (
                            <div className="space-y-3">
                                {caseData.activity_logs.map(log => (
                                    <div key={log.id} className="flex gap-3">
                                        <div className="flex flex-col items-center">
                                            <div className="w-7 h-7 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                                                <Activity size={13} color="#8b5cf6" />
                                            </div>
                                            <div className="w-px flex-1 bg-slate-100 mt-1" />
                                        </div>
                                        <div className="pb-4 min-w-0">
                                            <p className="text-sm font-medium text-slate-700">{formatAction(log.action)}</p>
                                            <p className="text-xs text-slate-400 mt-0.5">{formatDate(log.created_at)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>
                </div>

                {/* Right: Admin Actions Panel */}
                <div className="space-y-4">
                    <div className="card p-5 space-y-5 lg:sticky lg:top-6">
                        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <div className="w-6 h-6 rounded bg-purple-100 flex items-center justify-center">
                                <Save size={13} color="#8b5cf6" />
                            </div>
                            Admin Actions
                        </h3>

                        {saveSuccess && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
                                <Check size={13} />
                                Changes saved.
                            </div>
                        )}

                        {saveError && (
                            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                                <AlertCircle size={13} />
                                {saveError}
                            </div>
                        )}

                        {/* Status */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Case Status</label>
                            <div className="relative">
                                <select
                                    value={form.status}
                                    onChange={e => setField('status', e.target.value as PropertyCaseStatus)}
                                    className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors"
                                >
                                    {(Object.entries(STATUS_CONFIG) as [PropertyCaseStatus, { label: string }][]).map(([v, cfg]) => (
                                        <option key={v} value={v}>{cfg.label}</option>
                                    ))}
                                </select>
                                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Commission Status */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Commission Status</label>
                            <div className="relative">
                                <select
                                    value={form.commission_status}
                                    onChange={e => setField('commission_status', e.target.value as PropertyCommissionStatus)}
                                    className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors"
                                >
                                    <option value="pending">Pending</option>
                                    <option value="confirmed">Confirmed</option>
                                    <option value="paid">Paid</option>
                                </select>
                                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            </div>
                        </div>

                        {/* Commission Override */}
                        <div className="pt-2 border-t border-slate-100 space-y-2.5">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Commission (S$)</p>
                            {([
                                { label: 'Gross', key: 'gross_commission_amount' as const },
                                { label: 'Agent Share', key: 'agent_commission_amount' as const },
                                { label: 'TLC Share', key: 'tlc_commission_amount' as const },
                            ] as const).map(({ label, key }) => (
                                <div key={key} className="flex items-center gap-2">
                                    <label className="text-xs text-slate-500 w-20 shrink-0">{label}</label>
                                    <input
                                        type="number"
                                        value={form[key]}
                                        onChange={e => setField(key, e.target.value)}
                                        placeholder="—"
                                        className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors"
                                    />
                                </div>
                            ))}
                            <p className="text-xs text-slate-400">Pre-filled from case. Edit only if the actual amount differs.</p>
                        </div>

                        {/* Lock-in Confirmed Date */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Lock-in Confirmed Date</label>
                            <input
                                type="date"
                                value={form.lockin_confirmed_date}
                                onChange={e => setField('lockin_confirmed_date', e.target.value)}
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors"
                            />
                        </div>

                        {/* Recurring */}
                        <div className="pt-2 border-t border-slate-100">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.recurring_converted}
                                    onChange={e => setField('recurring_converted', e.target.checked)}
                                    className="rounded border-slate-300 text-purple-500 focus:ring-purple-400"
                                />
                                <span className="text-xs text-slate-600 font-medium">Opportunity Converted</span>
                            </label>
                            <p className="text-xs text-slate-400 mt-1 ml-5">Check when agent has submitted a new refinancing case.</p>
                        </div>

                        {/* Notes */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Admin Notes</label>
                            <textarea
                                value={form.notes}
                                onChange={e => setField('notes', e.target.value)}
                                rows={3}
                                placeholder="Internal notes for TLC team…"
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition-colors resize-none"
                            />
                        </div>

                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60"
                            style={{ background: '#8b5cf6', color: 'white' }}
                        >
                            {saving ? (
                                <>
                                    <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', animation: 'spin 0.8s linear infinite' }} />
                                    Saving…
                                </>
                            ) : (
                                <>
                                    <Save size={14} />
                                    Save Changes
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    )
}

export default function AdminCaseDetailPage() {
    return (
        <Suspense fallback={
            <div className="card p-12 flex items-center justify-center gap-3 text-slate-500 text-sm">
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #8b5cf6', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                Loading…
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        }>
            <AdminDetailContent />
        </Suspense>
    )
}
