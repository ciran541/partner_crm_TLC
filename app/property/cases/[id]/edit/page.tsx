'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
    Briefcase, User, Building2, StickyNote,
    AlertCircle, ChevronLeft, Check,
} from 'lucide-react'
import CaseTypeSelector from '@/components/property/CaseTypeSelector'
import BankDropdown from '@/components/property/BankDropdown'
import { calculateCommission } from '@/lib/property/commission'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { refreshCases } from '@/lib/property/useCases'
import type { PropertyCaseType, PropertyCaseStatus } from '@/lib/types/property'

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

const EDITABLE_STATUSES: PropertyCaseStatus[] = ['draft', 'submitted']

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <Icon size={16} color="#059669" />
            </div>
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
        </div>
    )
}

function Field({ label, required = false, error, children }: {
    label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {label}{required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {children}
            {error && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
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
            className={`w-full px-3 py-2.5 text-sm rounded-lg border transition-colors outline-none
                ${hasError
                    ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                    : 'border-slate-200 bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
                }`}
        />
    )
}

export default function EditCasePage() {
    const params = useParams()
    const router = useRouter()
    const caseId = params.id as string

    const [form, setForm] = useState<FormState | null>(null)
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch(`/api/property/cases/${caseId}`)
            .then(r => {
                if (!r.ok) throw new Error(r.status === 403 ? 'Access denied.' : 'Case not found.')
                return r.json()
            })
            .then(json => {
                const c = json.data
                if (!EDITABLE_STATUSES.includes(c.status)) {
                    setLoadError('This case can no longer be edited.')
                    return
                }
                setForm({
                    case_type: c.case_type ?? null,
                    client_name: c.client_name ?? '',
                    client_mobile: c.client_mobile ?? '',
                    client_email: c.client_email ?? '',
                    property_address: c.property_address ?? '',
                    bank_id: c.bank_id ?? '',
                    interest_rate: c.interest_rate != null ? String(c.interest_rate) : '',
                    balance_tenure_months: c.balance_tenure_months != null ? String(c.balance_tenure_months) : '',
                    outstanding_loan_amount: c.outstanding_loan_amount != null ? String(c.outstanding_loan_amount) : '',
                    subsidy_amount: c.subsidy_amount != null ? String(c.subsidy_amount) : '',
                    notes: c.notes ?? '',
                })
            })
            .catch(e => setLoadError(e.message))
            .finally(() => setLoading(false))
    }, [caseId])

    function set<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm(f => f ? ({ ...f, [key]: value }) : f)
        setFieldErrors(e => ({ ...e, [key as string]: undefined }))
    }

    const loanAmount = form ? (parseFloat(form.outstanding_loan_amount) || 0) : 0
    const commissionPreview = loanAmount > 0 ? calculateCommission(loanAmount) : null

    function validate(): boolean {
        if (!form) return false
        const errors: FieldErrors = {}
        if (!form.case_type) errors.case_type = 'Please select a case type'
        if (!form.client_name.trim()) errors.client_name = 'Client name is required'
        if (!form.client_mobile.trim()) errors.client_mobile = 'Client mobile is required'
        if (!form.property_address.trim()) errors.property_address = 'Property address is required'
        setFieldErrors(errors)
        return Object.keys(errors).length === 0
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form || !validate()) return

        setSubmitting(true)
        setSubmitError(null)

        try {
            const payload: Record<string, unknown> = {
                case_type: form.case_type,
                client_name: form.client_name.trim(),
                client_mobile: form.client_mobile.trim(),
                client_email: form.client_email.trim() || null,
                property_address: form.property_address.trim(),
                bank_id: form.bank_id || null,
                interest_rate: form.interest_rate ? parseFloat(form.interest_rate) : null,
                balance_tenure_months: form.balance_tenure_months ? parseInt(form.balance_tenure_months, 10) : null,
                outstanding_loan_amount: form.outstanding_loan_amount ? parseFloat(form.outstanding_loan_amount) : null,
                subsidy_amount: form.subsidy_amount ? parseFloat(form.subsidy_amount) : null,
                notes: form.notes.trim() || null,
            }

            const res = await fetch(`/api/property/cases/${caseId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            })

            const json = await res.json()

            if (!res.ok) {
                if (json.fields) setFieldErrors(json.fields)
                else setSubmitError(json.error ?? 'Failed to save changes.')
                return
            }

            refreshCases() // invalidate the shared cache so edits show up everywhere
            router.push(`/property/cases/${caseId}?updated=true`)
        } catch {
            setSubmitError('An unexpected error occurred. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
        return (
            <div className="card p-12 flex items-center justify-center gap-3 text-slate-500 text-sm">
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '3px solid #059669', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                Loading case…
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        )
    }

    if (loadError) {
        return (
            <div className="card p-8 flex flex-col items-center text-center gap-3">
                <AlertCircle size={28} className="text-red-400" />
                <p className="text-slate-600 text-sm">{loadError}</p>
                <button onClick={() => router.push(`/property/cases/${caseId}`)} className="btn-outline text-sm px-4 py-2">
                    Back to Case
                </button>
            </div>
        )
    }

    if (!form) return null

    return (
        <div className="space-y-5 max-w-2xl">
            <div>
                <button
                    onClick={() => router.push(`/property/cases/${caseId}`)}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3"
                >
                    <ChevronLeft size={14} />
                    Back to Case
                </button>
                <h1 className="text-[28px] md:text-2xl font-extrabold tracking-tight text-[#052d4a] flex items-center gap-2">
                    <Briefcase size={26} color="#059669" />
                    Edit Case
                </h1>
                <p className="text-sm text-slate-500 mt-1">Update case details before TLC begins review.</p>
            </div>

            {submitError && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
                    <AlertCircle size={15} />
                    {submitError}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
                {/* Case Type */}
                <div className="card p-6">
                    <SectionHeader icon={Briefcase} title="Case Type" />
                    <CaseTypeSelector
                        value={form.case_type}
                        onChange={v => set('case_type', v)}
                        error={fieldErrors.case_type}
                    />
                    {fieldErrors.case_type && (
                        <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
                            <AlertCircle size={11} />{fieldErrors.case_type}
                        </p>
                    )}
                </div>

                {/* Client Information */}
                <div className="card p-6">
                    <SectionHeader icon={User} title="Client Information" />
                    <div className="grid sm:grid-cols-2 gap-4">
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
                </div>

                {/* Mortgage Details */}
                <div className="card p-6">
                    <SectionHeader icon={Building2} title="Mortgage Details" />
                    <div className="grid sm:grid-cols-2 gap-4">
                        <Field label="Bank">
                            <BankDropdown value={form.bank_id} onChange={v => set('bank_id', v)} />
                        </Field>
                        <Field label="Interest Rate (% p.a.)">
                            <Input value={form.interest_rate} onChange={v => set('interest_rate', v)} placeholder="e.g. 3.15" type="number" />
                        </Field>
                        <Field label="Balance Tenure (months)">
                            <Input value={form.balance_tenure_months} onChange={v => set('balance_tenure_months', v)} placeholder="e.g. 240" type="number" />
                        </Field>
                        <Field label="Outstanding Loan Amount (S$)">
                            <Input value={form.outstanding_loan_amount} onChange={v => set('outstanding_loan_amount', v)} placeholder="e.g. 500000" type="number" />
                        </Field>
                        <Field label="Subsidy Amount (optional)">
                            <Input value={form.subsidy_amount} onChange={v => set('subsidy_amount', v)} placeholder="e.g. 2000" type="number" />
                        </Field>
                    </div>

                    {commissionPreview && (
                        <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-2">Estimated Commission</p>
                            <div className="flex flex-wrap gap-6">
                                <div>
                                    <p className="text-xs text-emerald-500">Gross</p>
                                    <p className="text-base font-bold text-emerald-800">{formatCurrency(commissionPreview.gross)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-emerald-500">Your Share (90%)</p>
                                    <p className="text-base font-bold text-emerald-900">{formatCurrency(commissionPreview.agent)}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-emerald-500">TLC Share (10%)</p>
                                    <p className="text-sm font-semibold text-emerald-700">{formatCurrency(commissionPreview.tlc)}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Notes */}
                <div className="card p-6">
                    <SectionHeader icon={StickyNote} title="Notes" />
                    <textarea
                        value={form.notes}
                        onChange={e => set('notes', e.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="Any additional notes for the TLC team (optional)…"
                        className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition-colors resize-none"
                    />
                    <p className="text-right text-xs text-slate-400 mt-1">{form.notes.length}/500</p>
                </div>

                <div className="flex gap-3 pb-6">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="btn-primary flex items-center gap-2 text-sm px-6 py-3 disabled:opacity-60"
                    >
                        {submitting ? (
                            <>
                                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white', animation: 'spin 0.8s linear infinite' }} />
                                Saving…
                            </>
                        ) : (
                            <>
                                <Check size={14} />
                                Save Changes
                            </>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => router.push(`/property/cases/${caseId}`)}
                        disabled={submitting}
                        className="btn-outline text-sm px-4 py-3"
                    >
                        Cancel
                    </button>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </form>
        </div>
    )
}
