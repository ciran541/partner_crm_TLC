'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import {
    ArrowLeft, AlertCircle, Check, User, Phone, Mail,
    MapPin, Building2, Percent, BadgeCheck, Calendar,
    FileText, DollarSign, TrendingUp, Activity, Pencil, Plus,
} from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { formatDate } from '@/lib/utils/formatDate'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import type {
    PropertyCase, PropertyCaseDocument,
    PropertyCaseActivityLog, PropertyCaseStatus, PropertyCaseType,
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
}

function formatAction(action: string) {
    return action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function InfoRow({ label, value, icon: Icon }: { label: string; value?: string | null; icon: React.ElementType }) {
    return (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
                width: 36, height: 36, borderRadius: 10,
                background: '#f8fafc',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
                <Icon size={15} color="#64748b" />
            </div>
            <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</p>
                <p style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</p>
            </div>
        </div>
    )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="card" style={{ padding: 24 }}>
            <h3 className="section-label" style={{ marginBottom: 20 }}>{title}</h3>
            {children}
        </div>
    )
}

function CommissionStatusDot({ status }: { status: string }) {
    const colors: Record<string, string> = {
        pending: '#f59e0b', confirmed: '#3b82f6', paid: '#059669',
    }
    const color = colors[status] ?? '#94a3b8'
    return (
        <span style={{
            display: 'inline-block', width: 7, height: 7,
            borderRadius: '50%', background: color, flexShrink: 0,
        }} />
    )
}

function CaseDetailContent() {
    const params = useParams()
    const searchParams = useSearchParams()
    const router = useRouter()
    const caseId = params.id as string
    const showSuccess = searchParams.get('submitted') === 'true'
    const showUpdated = searchParams.get('updated') === 'true'

    const [caseData, setCaseData] = useState<CaseDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        fetch(`/api/property/cases/${caseId}`)
            .then(r => {
                if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to this case.' : 'Case not found.')
                return r.json()
            })
            .then(json => setCaseData(json.data))
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [caseId])

    if (loading) {
        return (
            <div className="card" style={{ padding: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spinner size="md" color="#059669" label="Loading case…" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="card" style={{ padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
                <AlertCircle size={28} color="#f87171" />
                <p style={{ color: '#475569', fontSize: 14 }}>{error}</p>
                <button onClick={() => router.push('/property/cases')} className="btn-outline btn-sm">
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
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                    onClick={() => router.push('/property/cases')}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5, background: 'none',
                        border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 13, fontWeight: 500, padding: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#475569')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
                >
                    <ArrowLeft size={14} /> Cases
                </button>
                <span style={{ color: '#cbd5e1', fontSize: 13 }}>/</span>
                <span style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>{caseData.client_name}</span>
            </div>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#052d4a', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                        {caseData.client_name}
                    </h1>
                    <p style={{ fontSize: 13, color: '#64748b', marginTop: 5 }}>
                        {CASE_TYPE_LABELS[caseData.case_type]} · Submitted {formatDate(caseData.created_at)}
                    </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                        style={{
                            fontSize: 13, fontWeight: 700, padding: '7px 16px',
                            borderRadius: 9999, color: statusCfg.color, background: statusCfg.bg,
                        }}
                    >
                        {statusCfg.label}
                    </span>
                    {(caseData.status === 'draft' || caseData.status === 'submitted') && (
                        <button
                            onClick={() => router.push(`/property/cases/${caseId}/edit`)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 600,
                                border: '1px solid #e2e8f0', color: '#475569', background: 'white',
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.borderColor = '#34d399'
                                e.currentTarget.style.color = '#059669'
                                e.currentTarget.style.background = '#f0fdf4'
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.borderColor = '#e2e8f0'
                                e.currentTarget.style.color = '#475569'
                                e.currentTarget.style.background = 'white'
                            }}
                        >
                            <Pencil size={13} /> Edit
                        </button>
                    )}
                </div>
            </div>

            {/* Opportunity Due card */}
            {caseData.status === 'opportunity_due' && (
                <div
                    className="card"
                    style={{ padding: 24, background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)' }}
                >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                        <div style={{
                            width: 44, height: 44, borderRadius: 12,
                            background: 'rgba(255,255,255,0.2)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                            <TrendingUp size={22} color="white" />
                        </div>
                        <div style={{ flex: 1 }}>
                            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>Refinance Opportunity</h3>
                            <p style={{ fontSize: 13, color: '#fed7aa', marginTop: 5, lineHeight: 1.6 }}>
                                {caseData.client_name}&apos;s lock-in period is expiring in 90 days. Reach out to start the refinancing conversation.
                            </p>
                            {caseData.projected_agent_income != null && (
                                <div style={{ marginTop: 16 }}>
                                    <p style={{ fontSize: 10, color: '#fed7aa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Your projected commission</p>
                                    <p style={{ fontSize: 32, fontWeight: 800, color: 'white', letterSpacing: '-0.03em', lineHeight: 1 }}>
                                        {formatCurrency(caseData.projected_agent_income)}
                                    </p>
                                </div>
                            )}
                            <button
                                onClick={() => router.push('/property/cases/new')}
                                className="pressable"
                                style={{
                                    marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8,
                                    padding: '10px 18px', borderRadius: 9, background: 'white',
                                    color: '#c2410c', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer',
                                }}
                            >
                                <Plus size={14} /> Submit Refinancing Case
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Success / updated alerts */}
            {showSuccess && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 14, fontWeight: 500 }}>
                    <Check size={16} style={{ flexShrink: 0 }} />
                    Case submitted successfully! Our team will review it shortly.
                </div>
            )}
            {showUpdated && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 10, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#166534', fontSize: 14, fontWeight: 500 }}>
                    <Check size={16} style={{ flexShrink: 0 }} />
                    Case updated successfully.
                </div>
            )}

            {/* Commission card */}
            {hasCommission && (
                <div
                    className="card"
                    style={{ padding: 24, background: 'linear-gradient(135deg, #059669 0%, #065f46 100%)' }}
                >
                    <h3 style={{ fontSize: 11, fontWeight: 700, color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <DollarSign size={13} /> Commission
                    </h3>
                    {/* Mobile: flex-col, Desktop: grid-cols-3 */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 32px' }}>
                        <div>
                            <p style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 5 }}>Your Share (90%)</p>
                            <p style={{ fontSize: 28, fontWeight: 800, color: 'white', letterSpacing: '-0.03em', lineHeight: 1 }}>
                                {formatCurrency(caseData.agent_commission_amount)}
                            </p>
                        </div>
                        <div>
                            <p style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 5 }}>Gross</p>
                            <p style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.9)', lineHeight: 1 }}>
                                {formatCurrency(caseData.gross_commission_amount)}
                            </p>
                        </div>
                        <div>
                            <p style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 5 }}>TLC Share (10%)</p>
                            <p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.65)', lineHeight: 1 }}>
                                {formatCurrency(caseData.tlc_commission_amount)}
                            </p>
                        </div>
                    </div>
                    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CommissionStatusDot status={caseData.commission_status ?? 'pending'} />
                        <span style={{ fontSize: 12, color: '#a7f3d0' }}>Commission Status:</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'white', textTransform: 'capitalize' }}>
                            {caseData.commission_status ?? 'Pending'}
                        </span>
                    </div>
                </div>
            )}

            {/* Client */}
            <Section title="Client Information">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                    <InfoRow icon={User} label="Full Name" value={caseData.client_name} />
                    <InfoRow icon={Phone} label="Mobile" value={caseData.client_mobile} />
                    {caseData.client_email && <InfoRow icon={Mail} label="Email" value={caseData.client_email} />}
                    <InfoRow icon={MapPin} label="Property Address" value={caseData.property_address} />
                </div>
            </Section>

            {/* Mortgage */}
            <Section title="Mortgage Details">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                    <InfoRow icon={Building2} label="Bank" value={caseData.banks?.name} />
                    <InfoRow icon={Percent} label="Interest Rate" value={caseData.interest_rate != null ? `${caseData.interest_rate}%` : null} />
                    <InfoRow icon={Calendar} label="Balance Tenure" value={caseData.balance_tenure_months != null ? `${caseData.balance_tenure_months} months` : null} />
                    <InfoRow icon={DollarSign} label="Outstanding Loan" value={caseData.outstanding_loan_amount ? formatCurrency(caseData.outstanding_loan_amount) : null} />
                    {caseData.subsidy_amount != null && (
                        <InfoRow icon={DollarSign} label="Subsidy Amount" value={formatCurrency(caseData.subsidy_amount)} />
                    )}
                </div>
            </Section>

            {/* Lock-in & projection */}
            <Section title="Lock-in & Projection">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
                    <InfoRow
                        icon={BadgeCheck}
                        label="Lock-in Confirmed Date"
                        value={caseData.lockin_confirmed_date ? formatDate(caseData.lockin_confirmed_date) : 'Pending — TLC will confirm after review'}
                    />
                </div>
                {hasProjection && (
                    <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <TrendingUp size={12} /> Projected at Lock-in Maturity (24 months)
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                            {[
                                { label: 'Remaining Balance', value: caseData.projected_remaining_balance },
                                { label: 'Gross Commission', value: caseData.projected_gross_commission },
                                { label: 'Your Income', value: caseData.projected_agent_income },
                                { label: 'TLC Income', value: caseData.projected_tlc_income },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ background: '#f8fafc', borderRadius: 10, padding: 14 }}>
                                    <p style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</p>
                                    <p style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{value ? formatCurrency(value) : '—'}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </Section>

            {/* Notes */}
            {caseData.notes && (
                <Section title="Notes">
                    <p style={{ fontSize: 14, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{caseData.notes}</p>
                </Section>
            )}

            {/* Documents */}
            <Section title="Documents">
                {caseData.documents.length === 0 ? (
                    <p style={{ fontSize: 14, color: '#94a3b8' }}>No documents attached.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {caseData.documents.map(doc => (
                            <a
                                key={doc.id}
                                href={doc.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="pressable"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '12px 14px', borderRadius: 10,
                                    border: '1px solid #e2e8f0', textDecoration: 'none',
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = '#34d399'
                                    e.currentTarget.style.background = '#f0fdf4'
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = '#e2e8f0'
                                    e.currentTarget.style.background = 'transparent'
                                }}
                            >
                                <FileText size={16} color="#94a3b8" style={{ flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</p>
                                    <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{formatDate(doc.created_at)}</p>
                                </div>
                            </a>
                        ))}
                    </div>
                )}
            </Section>

            {/* Activity Log */}
            <Section title="Activity Log">
                {caseData.activity_logs.length === 0 ? (
                    <p style={{ fontSize: 14, color: '#94a3b8' }}>No activity recorded.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {caseData.activity_logs.map((log, idx) => (
                            <div key={log.id} style={{ display: 'flex', gap: 12 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div style={{
                                        width: 28, height: 28, borderRadius: '50%',
                                        background: '#ecfdf5', border: '2px solid #a7f3d0',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    }}>
                                        <Activity size={12} color="#059669" />
                                    </div>
                                    {idx < caseData.activity_logs.length - 1 && (
                                        <div style={{ width: 2, flex: 1, background: '#e2e8f0', marginTop: 4 }} />
                                    )}
                                </div>
                                <div style={{ paddingBottom: 20, minWidth: 0 }}>
                                    <p style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>{formatAction(log.action)}</p>
                                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{formatDate(log.created_at)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Section>
        </div>
    )
}

export default function CaseDetailPage() {
    return (
        <Suspense fallback={
            <div className="card" style={{ padding: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Spinner size="md" color="#059669" label="Loading…" />
            </div>
        }>
            <CaseDetailContent />
        </Suspense>
    )
}
