'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
    Briefcase, User, Building2, FileText, StickyNote,
    AlertCircle, ChevronLeft, ChevronRight, Check, CheckCircle2,
} from 'lucide-react'
import CaseTypeSelector from '@/components/property/CaseTypeSelector'
import BankDropdown from '@/components/property/BankDropdown'
import DocumentUploader from '@/components/property/DocumentUploader'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import { calculateCommission } from '@/lib/property/commission'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { supabase } from '@/lib/supabase/client'
import type { PropertyCaseType } from '@/lib/types/property'

interface FormState {
    case_type: PropertyCaseType | null
    client_name: string
    client_mobile: string
    client_email: string
    property_address: string
    bank_id: string
    interest_rate: string
    balance_tenure_months: string
    outstanding_loan_amount: string
    subsidy_amount: string
    notes: string
}

interface FieldErrors { [key: string]: string | undefined }

const INITIAL_FORM: FormState = {
    case_type: null,
    client_name: '', client_mobile: '', client_email: '', property_address: '',
    bank_id: '', interest_rate: '', balance_tenure_months: '',
    outstanding_loan_amount: '', subsidy_amount: '',
    notes: '',
}

const STEP_LABELS = ['Case Type', 'Client Info', 'Mortgage', 'Submit']

function StepBar({ current }: { current: number }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
            {STEP_LABELS.map((label, i) => {
                const isDone = i < current
                const isCurrent = i === current
                return (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', flex: i < STEP_LABELS.length - 1 ? 1 : undefined }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: '50%',
                                background: isDone ? '#059669' : isCurrent ? '#052d4a' : 'white',
                                border: `2px solid ${isDone ? '#059669' : isCurrent ? '#052d4a' : '#e2e8f0'}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 13, fontWeight: 700,
                                color: isDone || isCurrent ? 'white' : '#94a3b8',
                                flexShrink: 0, transition: 'all 0.25s',
                            }}>
                                {isDone ? <Check size={14} /> : i + 1}
                            </div>
                            <span style={{
                                fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
                                color: isDone ? '#059669' : isCurrent ? '#052d4a' : '#94a3b8',
                                transition: 'color 0.25s',
                            }}>
                                {label}
                            </span>
                        </div>
                        {i < STEP_LABELS.length - 1 && (
                            <div style={{
                                flex: 1, height: 2, margin: '0 8px', marginBottom: 14,
                                background: isDone ? '#059669' : '#e2e8f0',
                                borderRadius: 2, transition: 'background 0.3s',
                            }} />
                        )}
                    </div>
                )
            })}
        </div>
    )
}

function StepHeading({ step, icon: Icon, iconBg, iconColor, title, subtitle }: {
    step: number; icon: React.ElementType; iconBg: string; iconColor: string; title: string; subtitle?: string
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={22} color={iconColor} />
            </div>
            <div>
                <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>
                    Step {step} of 4
                </p>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>{title}</h3>
                {subtitle && <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 3 }}>{subtitle}</p>}
            </div>
        </div>
    )
}

function Field({ label, required = false, error, children }: {
    label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
    return (
        <div>
            <label className="form-label">
                {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
            </label>
            {children}
            {error && (
                <p style={{ marginTop: 5, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertCircle size={11} />{error}
                </p>
            )}
        </div>
    )
}

function Input({ value, onChange, placeholder, type = 'text', hasError = false }: {
    value: string; onChange: (v: string) => void; placeholder?: string; type?: string; hasError?: boolean
}) {
    return (
        <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
                width: '100%', padding: '12px 14px', fontSize: 14,
                borderRadius: 10, border: `1px solid ${hasError ? '#fca5a5' : '#d1d5db'}`,
                background: hasError ? '#fef2f2' : 'white', outline: 'none',
                color: '#0f172a', transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onFocus={e => {
                e.target.style.borderColor = hasError ? '#f87171' : '#059669'
                e.target.style.boxShadow = hasError ? '0 0 0 3px rgba(248,113,113,0.15)' : '0 0 0 3px rgba(5,150,105,0.12)'
            }}
            onBlur={e => {
                e.target.style.borderColor = hasError ? '#fca5a5' : '#d1d5db'
                e.target.style.boxShadow = 'none'
            }}
        />
    )
}

function NavRow({ onBack, onNext, nextLabel = 'Next', loading = false }: {
    onBack?: () => void; onNext?: () => void; nextLabel?: string; loading?: boolean
}) {
    return (
        <div style={{ display: 'flex', justifyContent: onBack ? 'space-between' : 'flex-end', alignItems: 'center', marginTop: 32 }}>
            {onBack && (
                <button type="button" onClick={onBack} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ChevronLeft size={15} /> Back
                </button>
            )}
            {onNext && (
                <button type="button" onClick={onNext} className="btn-emerald" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {nextLabel} <ChevronRight size={15} />
                </button>
            )}
            {!onNext && (
                <button
                    type="submit"
                    disabled={loading}
                    className="btn-emerald btn-lg"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}
                >
                    {loading ? <Spinner size="sm" color="white" label="Submitting…" /> : <><Check size={16} /> Submit Case</>}
                </button>
            )}
        </div>
    )
}

export default function NewCasePage() {
    const router = useRouter()
    const [step, setStep] = useState(0)
    const [form, setForm] = useState<FormState>(INITIAL_FORM)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    function set<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm(f => ({ ...f, [key]: value }))
        setFieldErrors(e => ({ ...e, [key as string]: undefined }))
    }

    const loanAmount = parseFloat(form.outstanding_loan_amount) || 0
    const commissionPreview = loanAmount > 0 ? calculateCommission(loanAmount) : null

    function validateStep(s: number): boolean {
        const errors: FieldErrors = {}
        if (s === 0 && !form.case_type) errors.case_type = 'Please select a case type'
        if (s === 1) {
            if (!form.client_name.trim()) errors.client_name = 'Client name is required'
            if (!form.client_mobile.trim()) errors.client_mobile = 'Mobile number is required'
            if (!form.property_address.trim()) errors.property_address = 'Property address is required'
        }
        setFieldErrors(errors)
        return Object.keys(errors).length === 0
    }

    function handleNext() {
        if (!validateStep(step)) return
        setStep(s => s + 1)
    }

    function handleBack() {
        setFieldErrors({})
        setStep(s => s - 1)
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSubmitting(true)
        setSubmitError(null)

        try {
            const payload = {
                case_type: form.case_type!,
                client_name: form.client_name.trim(),
                client_mobile: form.client_mobile.trim(),
                ...(form.client_email.trim() && { client_email: form.client_email.trim() }),
                property_address: form.property_address.trim(),
                ...(form.bank_id && { bank_id: form.bank_id }),
                ...(form.interest_rate && { interest_rate: parseFloat(form.interest_rate) }),
                ...(form.balance_tenure_months && { balance_tenure_months: parseInt(form.balance_tenure_months, 10) }),
                ...(form.outstanding_loan_amount && { outstanding_loan_amount: parseFloat(form.outstanding_loan_amount) }),
                ...(form.subsidy_amount && { subsidy_amount: parseFloat(form.subsidy_amount) }),
                ...(form.notes.trim() && { notes: form.notes.trim() }),
            }

            const res = await fetch('/api/property/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })

            const json = await res.json()

            if (!res.ok) {
                if (json.fields) setFieldErrors(json.fields)
                else setSubmitError(json.error ?? 'Failed to submit case. Please try again.')
                return
            }

            const caseId: string = json.data.id

            if (selectedFile) {
                try {
                    const { data: { user } } = await supabase.auth.getUser()
                    if (user) {
                        const ext = selectedFile.name.split('.').pop()
                        const path = `${user.id}/${caseId}/${Date.now()}.${ext}`
                        const { error: uploadError } = await supabase.storage
                            .from('property-documents')
                            .upload(path, selectedFile)

                        if (!uploadError) {
                            await fetch(`/api/property/cases/${caseId}/documents`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    file_url: path,
                                    file_name: selectedFile.name,
                                    file_type: selectedFile.type,
                                }),
                            })
                        }
                    }
                } catch {
                    // Document upload is non-fatal
                }
            }

            router.push(`/property/cases/${caseId}?submitted=true`)
        } catch {
            setSubmitError('An unexpected error occurred. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <button
                onClick={() => router.push('/property/cases')}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
                    color: '#94a3b8', background: 'none', border: 'none',
                    cursor: 'pointer', marginBottom: 20, padding: 0, fontWeight: 500,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#475569')}
                onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
            >
                <ChevronLeft size={15} /> Back to Cases
            </button>

            <div style={{ marginBottom: 28 }}>
                <h1 style={{ fontSize: 24, fontWeight: 800, color: '#052d4a', letterSpacing: '-0.02em' }}>Submit a New Case</h1>
                <p style={{ fontSize: 14, color: '#64748b', marginTop: 5 }}>Fill in the details below to track your mortgage opportunity.</p>
            </div>

            <StepBar current={step} />

            {submitError && (
                <div style={{ marginBottom: 20 }}>
                    <InlineAlert type="error" message={submitError} onDismiss={() => setSubmitError(null)} />
                </div>
            )}

            <form onSubmit={handleSubmit}>

                {/* ── Step 1: Case Type ── */}
                {step === 0 && (
                    <div className="card" style={{ padding: 28 }}>
                        <StepHeading step={1} icon={Briefcase} iconBg="#ecfdf5" iconColor="#059669"
                            title="What type of case is this?" />
                        <CaseTypeSelector
                            value={form.case_type}
                            onChange={v => {
                                set('case_type', v)
                                setFieldErrors({})
                                setTimeout(() => setStep(1), 280)
                            }}
                            error={fieldErrors.case_type}
                        />
                        {fieldErrors.case_type && (
                            <p style={{ marginTop: 8, fontSize: 12, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <AlertCircle size={11} />{fieldErrors.case_type}
                            </p>
                        )}
                        <NavRow onNext={handleNext} nextLabel="Next" />
                    </div>
                )}

                {/* ── Step 2: Client Information ── */}
                {step === 1 && (
                    <div className="card" style={{ padding: 28 }}>
                        <StepHeading step={2} icon={User} iconBg="#eff6ff" iconColor="#3b82f6"
                            title="Client Information" subtitle="Who is the mortgage for?" />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                            <Field label="Full Name" required error={fieldErrors.client_name}>
                                <Input value={form.client_name} onChange={v => set('client_name', v)} placeholder="Jane Tan" hasError={!!fieldErrors.client_name} />
                            </Field>
                            <Field label="Mobile Number" required error={fieldErrors.client_mobile}>
                                <Input value={form.client_mobile} onChange={v => set('client_mobile', v)} placeholder="+65 9123 4567" hasError={!!fieldErrors.client_mobile} />
                            </Field>
                            <Field label="Email (optional)">
                                <Input value={form.client_email} onChange={v => set('client_email', v)} placeholder="jane@email.com" type="email" />
                            </Field>
                            <Field label="Property Address" required error={fieldErrors.property_address}>
                                <Input value={form.property_address} onChange={v => set('property_address', v)} placeholder="123 Orchard Road, Singapore" hasError={!!fieldErrors.property_address} />
                            </Field>
                        </div>
                        <NavRow onBack={handleBack} onNext={handleNext} />
                    </div>
                )}

                {/* ── Step 3: Mortgage Details ── */}
                {step === 2 && (
                    <div className="card" style={{ padding: 28 }}>
                        <StepHeading step={3} icon={Building2} iconBg="#fef3c7" iconColor="#d97706"
                            title="Mortgage Details" subtitle="All fields are optional — fill what you know." />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                            <Field label="Bank">
                                <BankDropdown value={form.bank_id} onChange={v => set('bank_id', v)} />
                            </Field>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <Field label="Interest Rate (% p.a.)">
                                    <Input value={form.interest_rate} onChange={v => set('interest_rate', v)} placeholder="3.15" type="number" />
                                </Field>
                                <Field label="Balance Tenure (months)">
                                    <Input value={form.balance_tenure_months} onChange={v => set('balance_tenure_months', v)} placeholder="240" type="number" />
                                </Field>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                <Field label="Outstanding Loan (S$)">
                                    <Input value={form.outstanding_loan_amount} onChange={v => set('outstanding_loan_amount', v)} placeholder="500000" type="number" />
                                </Field>
                                <Field label="Subsidy Amount (S$)">
                                    <Input value={form.subsidy_amount} onChange={v => set('subsidy_amount', v)} placeholder="2000" type="number" />
                                </Field>
                            </div>
                        </div>

                        {commissionPreview && (
                            <div style={{
                                marginTop: 24, borderRadius: 12,
                                background: 'linear-gradient(135deg, #059669 0%, #065f46 100%)',
                                padding: '20px 24px',
                            }}>
                                <p style={{ fontSize: 10, fontWeight: 700, color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
                                    Estimated Commission
                                </p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px', alignItems: 'flex-end' }}>
                                    <div>
                                        <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 4 }}>Your Share (90%)</p>
                                        <p style={{ fontSize: 28, fontWeight: 800, color: 'white', letterSpacing: '-0.03em', lineHeight: 1 }}>
                                            {formatCurrency(commissionPreview.agent)}
                                        </p>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 4 }}>Gross</p>
                                        <p style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>
                                            {formatCurrency(commissionPreview.gross)}
                                        </p>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 4 }}>TLC (10%)</p>
                                        <p style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.6)', lineHeight: 1 }}>
                                            {formatCurrency(commissionPreview.tlc)}
                                        </p>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                                    <CheckCircle2 size={13} color="#a7f3d0" />
                                    <span style={{ fontSize: 12, color: '#a7f3d0' }}>Estimate based on outstanding loan amount</span>
                                </div>
                            </div>
                        )}

                        <NavRow onBack={handleBack} onNext={handleNext} />
                    </div>
                )}

                {/* ── Step 4: Review & Submit ── */}
                {step === 3 && (
                    <div className="card" style={{ padding: 28 }}>
                        <StepHeading step={4} icon={FileText} iconBg="#f5f3ff" iconColor="#7c3aed"
                            title="Review & Submit" subtitle="Check your details, attach a document, then submit." />

                        {/* Summary of previous steps */}
                        <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 18px', marginBottom: 24 }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Summary</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                                <SummaryRow label="Case Type" value={form.case_type ?? '—'} />
                                <SummaryRow label="Client" value={form.client_name || '—'} />
                                <SummaryRow label="Mobile" value={form.client_mobile || '—'} />
                                {form.property_address && <SummaryRow label="Property" value={form.property_address} />}
                                {form.outstanding_loan_amount && (
                                    <SummaryRow label="Loan Amount" value={`S$${parseInt(form.outstanding_loan_amount).toLocaleString()}`} />
                                )}
                                {commissionPreview && (
                                    <SummaryRow label="Est. Commission" value={formatCurrency(commissionPreview.agent)} highlight />
                                )}
                            </div>
                        </div>

                        {/* Document upload */}
                        <div style={{ marginBottom: 24 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                                Document <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                            </p>
                            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Attach a Letter of Offer or supporting document.</p>
                            <DocumentUploader onFileSelect={setSelectedFile} selectedFile={selectedFile} />
                        </div>

                        {/* Notes */}
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                                <StickyNote size={14} color="#94a3b8" />
                                <p style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                                    Notes <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>(optional)</span>
                                </p>
                            </div>
                            <textarea
                                value={form.notes}
                                onChange={e => set('notes', e.target.value)}
                                maxLength={500}
                                rows={3}
                                placeholder="Any additional notes for the TLC team…"
                                style={{
                                    width: '100%', padding: '12px 14px', fontSize: 14,
                                    borderRadius: 10, border: '1px solid #d1d5db',
                                    background: 'white', outline: 'none', resize: 'none',
                                    color: '#0f172a', transition: 'border-color 0.15s',
                                    fontFamily: 'inherit',
                                }}
                                onFocus={e => { e.target.style.borderColor = '#059669'; e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)' }}
                                onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none' }}
                            />
                            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 5, textAlign: 'right' }}>{form.notes.length}/500</p>
                        </div>

                        <NavRow onBack={handleBack} loading={submitting} />
                        <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 14 }}>
                            Our team will review your case within 1–2 business days.
                        </p>
                    </div>
                )}
            </form>
        </div>
    )
}

function SummaryRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, color: '#64748b', minWidth: 110 }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: highlight ? 700 : 600, color: highlight ? '#059669' : '#0f172a' }}>{value}</span>
        </div>
    )
}
