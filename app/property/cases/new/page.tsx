'use client'

import { useState, useEffect, useRef } from 'react'
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
import { projectAtLockinMaturity } from '@/lib/property/amortization'
import { formatCurrency } from '@/lib/utils/formatCurrency'
import { supabase } from '@/lib/supabase/client'
import { refreshCases } from '@/lib/property/useCases'
import {
    BANKER_DATA, RESIDENTIAL_PROPERTY_TYPES, COMMERCIAL_PROPERTY_TYPES,
    FLOATING_RATE_TYPES, type CaseCategory, type FloatingRateType,
} from '@/lib/property/bankerData'
import type { PropertyCaseType } from '@/lib/types/property'

interface FormState {
    case_type: PropertyCaseType | null
    client_name: string
    client_mobile: string
    client_email: string
    // Step 3 fields
    bank_id: string
    case_category: CaseCategory | ''
    banker_name: string
    property_type: string
    outstanding_loan_amount: string
    balance_tenure_months: string
    subsidy_amount: string
    lock_in_period: string
    free_conversion: string
    package_type: 'fixed' | 'floating' | ''
    fixed_years: string
    floating_rate_type: FloatingRateType
    year_rates: string[]
    letter_of_offer_date: string
    followup_preference: 'self' | 'tlc' | ''
    notes: string
}

interface FieldErrors { [key: string]: string | undefined }

const INITIAL_FORM: FormState = {
    case_type: null,
    client_name: '', client_mobile: '', client_email: '',
    bank_id: '',
    case_category: '',
    banker_name: '',
    property_type: '',
    outstanding_loan_amount: '', balance_tenure_months: '', subsidy_amount: '',
    lock_in_period: '', free_conversion: '',
    package_type: '', fixed_years: '',
    floating_rate_type: '1MSORA',
    year_rates: [],
    letter_of_offer_date: '',
    followup_preference: '',
    notes: '',
}

const STEP_LABELS = ['Case Type', 'Client Info', 'Mortgage', 'Submit']

// ── Shared UI primitives ──────────────────────────────────────────────────────

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

function TextInput({ value, onChange, placeholder, type = 'text', hasError = false }: {
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

const selectStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: 14,
    borderRadius: 10, border: '1px solid #d1d5db',
    background: 'white', outline: 'none', color: '#0f172a',
    appearance: 'auto', cursor: 'pointer',
}

function SectionDivider({ label }: { label: string }) {
    return (
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 20, marginTop: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>
                {label}
            </p>
        </div>
    )
}

function PillToggle({ options, value, onChange }: {
    options: { value: string; label: string }[]
    value: string
    onChange: (v: string) => void
}) {
    return (
        <div style={{ display: 'flex', gap: 8 }}>
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    style={{
                        padding: '8px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                        border: `1.5px solid ${value === opt.value ? '#059669' : '#e2e8f0'}`,
                        background: value === opt.value ? '#059669' : 'white',
                        color: value === opt.value ? 'white' : '#64748b',
                        transition: 'all 0.15s',
                    }}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

function YearPills({ max, value, onChange }: { max: number; value: string; onChange: (v: string) => void }) {
    return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Array.from({ length: max }, (_, i) => String(i + 1)).map(yr => (
                <button
                    key={yr}
                    type="button"
                    onClick={() => onChange(yr)}
                    style={{
                        width: 40, height: 36, fontSize: 13, fontWeight: 600, borderRadius: 8, cursor: 'pointer',
                        border: `1.5px solid ${value === yr ? '#059669' : '#e2e8f0'}`,
                        background: value === yr ? '#059669' : 'white',
                        color: value === yr ? 'white' : '#64748b',
                        transition: 'all 0.15s',
                    }}
                >
                    {yr}
                </button>
            ))}
        </div>
    )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NewCasePage() {
    const router = useRouter()
    const [step, setStep] = useState(0)
    const [form, setForm] = useState<FormState>(INITIAL_FORM)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [banks, setBanks] = useState<{ id: string; name: string }[]>([])

    useEffect(() => {
        fetch('/api/property/banks')
            .then(r => r.json())
            .then(d => setBanks(Array.isArray(d) ? d : (d.data ?? [])))
            .catch(() => {})
    }, [])

    function set<K extends keyof FormState>(key: K, value: FormState[K]) {
        setForm(f => ({ ...f, [key]: value }))
        setFieldErrors(e => ({ ...e, [key as string]: undefined }))
    }

    function setYearRate(index: number, value: string) {
        setForm(f => {
            const next = [...f.year_rates]
            next[index] = value
            return { ...f, year_rates: next }
        })
    }

    // ── Step 3 derived values ─────────────────────────────────────────────────
    const bankName = banks.find(b => b.id === form.bank_id)?.name ?? ''
    const lockInNum = parseInt(form.lock_in_period) || 0
    const fixedYearsNum = parseInt(form.fixed_years) || 0
    const loanAmount = parseFloat(form.outstanding_loan_amount) || 0
    const tenureMonths = (parseInt(form.balance_tenure_months) || 0) * 12
    const commissionPreview = loanAmount > 0 ? calculateCommission(loanAmount) : null

    // Future refinancing projection (used in Step 4)
    const isFullyFixed = form.package_type === 'fixed' && fixedYearsNum === lockInNum && lockInNum > 0
    const hasFloating = lockInNum > 0 && !isFullyFixed
    const avgFixedRate = isFullyFixed && form.year_rates.length > 0
        ? form.year_rates.reduce((s, r) => s + (parseFloat(r) || 0), 0) / form.year_rates.length
        : 2.5
    const futureProjection = loanAmount > 0 && lockInNum > 0 && tenureMonths > lockInNum * 12
        ? projectAtLockinMaturity({
            outstandingLoanAmount: loanAmount,
            annualInterestRate: hasFloating ? 2.5 : avgFixedRate,
            balanceTenureMonths: tenureMonths,
            lockinMaturityMonths: lockInNum * 12,
        })
        : null

    const maxYears = form.case_category === 'commercial' ? 3 : 5
    const lockInOptions = Array.from({ length: maxYears }, (_, i) => String(i + 1))

    const bankerList: string[] = (form.case_category && bankName)
        ? (BANKER_DATA[bankName]?.[form.case_category as CaseCategory] ?? [])
        : []

    const propertyTypes = form.case_category === 'commercial'
        ? COMMERCIAL_PROPERTY_TYPES
        : RESIDENTIAL_PROPERTY_TYPES

    // Progressive reveal flags
    const showCaseCategory = !!form.bank_id
    const showBanker = showCaseCategory && !!form.case_category
    const showPropertyType = showBanker && !!form.banker_name
    const showLoanFields = showPropertyType && !!form.property_type
    const showPackage = showLoanFields && !!form.outstanding_loan_amount && !!form.balance_tenure_months && lockInNum > 0
    const showYearRates = showPackage && (
        form.package_type === 'floating' ||
        (form.package_type === 'fixed' && fixedYearsNum > 0)
    )
    const allYearRatesFilled = form.year_rates.length === lockInNum && lockInNum > 0 && form.year_rates.every(r => r.trim() !== '')
    const showLetterOfOffer = showYearRates && allYearRatesFilled
    const step3Complete = showLetterOfOffer // Next button enabled once LOO section visible

    // ── Scroll refs ──────────────────────────────────────────────────────────
    const refFormTop       = useRef<HTMLDivElement>(null)
    const refCaseCategory  = useRef<HTMLDivElement>(null)
    const refBanker        = useRef<HTMLDivElement>(null)
    const refPropertyType  = useRef<HTMLDivElement>(null)
    const refLoanFields    = useRef<HTMLDivElement>(null)
    const refPackage       = useRef<HTMLDivElement>(null)
    const refLetterOfOffer = useRef<HTMLDivElement>(null)

    function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
        requestAnimationFrame(() => {
            ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }

    useEffect(() => { if (showCaseCategory)  scrollTo(refCaseCategory)  }, [showCaseCategory])
    useEffect(() => { if (showBanker)        scrollTo(refBanker)        }, [showBanker])
    useEffect(() => { if (showPropertyType)  scrollTo(refPropertyType)  }, [showPropertyType])
    useEffect(() => { if (showLoanFields)    scrollTo(refLoanFields)    }, [showLoanFields])
    useEffect(() => { if (showPackage)       scrollTo(refPackage)       }, [showPackage])
    useEffect(() => { if (showLetterOfOffer) scrollTo(refLetterOfOffer) }, [showLetterOfOffer])

    // ── Handlers ──────────────────────────────────────────────────────────────

    function handleBankChange(id: string) {
        setForm(f => ({
            ...f,
            bank_id: id,
            case_category: '', banker_name: '', property_type: '',
            lock_in_period: '', free_conversion: '', package_type: '', fixed_years: '', year_rates: [],
        }))
    }

    function handleCategoryChange(cat: string) {
        setForm(f => ({
            ...f,
            case_category: cat as CaseCategory,
            banker_name: '', property_type: '',
            lock_in_period: '', free_conversion: '', package_type: '', fixed_years: '', year_rates: [],
        }))
    }

    function handleBankerChange(name: string) {
        setForm(f => ({
            ...f,
            banker_name: name,
            property_type: '',
            lock_in_period: '', free_conversion: '', package_type: '', fixed_years: '', year_rates: [],
        }))
    }

    function handlePropertyTypeChange(pt: string) {
        setForm(f => ({
            ...f,
            property_type: pt,
            lock_in_period: '', free_conversion: '', package_type: '', fixed_years: '', year_rates: [],
        }))
    }

    function handleLockInChange(val: string) {
        const n = parseInt(val) || 0
        setForm(f => ({
            ...f,
            lock_in_period: val,
            package_type: '', fixed_years: '',
            year_rates: Array(n).fill(''),
        }))
    }

    function handlePackageTypeChange(pt: string) {
        setForm(f => ({
            ...f,
            package_type: pt as 'fixed' | 'floating',
            fixed_years: '',
            year_rates: pt === 'floating' ? Array(lockInNum).fill('') : Array(lockInNum).fill(''),
        }))
    }

    function handleFixedYearsChange(fy: string) {
        setForm(f => ({ ...f, fixed_years: fy, year_rates: Array(lockInNum).fill('') }))
    }

    function handleFloatingRateTypeChange(rt: FloatingRateType) {
        setForm(f => ({ ...f, floating_rate_type: rt }))
    }

    // ── Validation ────────────────────────────────────────────────────────────

    function validateStep(s: number): boolean {
        const errors: FieldErrors = {}
        if (s === 0 && !form.case_type) errors.case_type = 'Please select a case type'
        if (s === 1) {
            if (!form.client_name.trim()) errors.client_name = 'Client name is required'
            if (!form.client_mobile.trim()) errors.client_mobile = 'Mobile number is required'
            if (!form.client_email.trim()) errors.client_email = 'Email is required'
        }
        setFieldErrors(errors)
        return Object.keys(errors).length === 0
    }

    function handleNext() {
        if (!validateStep(step)) return
        setStep(s => s + 1)
        scrollTo(refFormTop)
    }

    function handleBack() {
        setFieldErrors({})
        setStep(s => s - 1)
        scrollTo(refFormTop)
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!form.followup_preference) {
            setSubmitError('Please select a follow-up preference before submitting.')
            return
        }
        if (!selectedFile) {
            setSubmitError('Please attach a Letter of Offer or supporting document before submitting.')
            return
        }
        setSubmitting(true)
        setSubmitError(null)

        try {
            const payload: Record<string, unknown> = {
                case_type: form.case_type!,
                client_name: form.client_name.trim(),
                client_mobile: form.client_mobile.trim(),
                client_email: form.client_email.trim(),
                ...(form.bank_id && { bank_id: form.bank_id }),
                ...(form.case_category && { case_category: form.case_category }),
                ...(form.banker_name && { banker_name: form.banker_name }),
                ...(form.property_type && { property_type: form.property_type }),
                ...(form.outstanding_loan_amount && { outstanding_loan_amount: parseFloat(form.outstanding_loan_amount) }),
                ...(form.balance_tenure_months && { balance_tenure_months: parseInt(form.balance_tenure_months, 10) * 12 }),
                ...(form.subsidy_amount && { subsidy_amount: parseFloat(form.subsidy_amount) }),
                ...(form.lock_in_period && { lock_in_period: parseInt(form.lock_in_period, 10) }),
                ...(form.free_conversion && { free_conversion: parseInt(form.free_conversion, 10) }),
                ...(form.package_type && { package_type: form.package_type }),
                ...(form.fixed_years && { fixed_years: parseInt(form.fixed_years, 10) }),
                ...(form.floating_rate_type && { floating_rate_type: form.floating_rate_type }),
                ...(form.year_rates.length > 0 && { year_rates: form.year_rates }),
                ...(form.letter_of_offer_date && { letter_of_offer_date: form.letter_of_offer_date }),
                ...(form.followup_preference && { followup_preference: form.followup_preference }),
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
                                body: JSON.stringify({ file_url: path, file_name: selectedFile.name, file_type: selectedFile.type }),
                            })
                        }
                    }
                } catch {
                    // Document upload is non-fatal
                }
            }

            refreshCases()
            router.push(`/property/cases/${caseId}?submitted=true`)
        } catch {
            setSubmitError('An unexpected error occurred. Please try again.')
        } finally {
            setSubmitting(false)
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div ref={refFormTop} style={{ maxWidth: 640, margin: '0 auto' }}>
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
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
                            <button type="button" onClick={handleNext} className="btn-emerald" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                Next <ChevronRight size={15} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 2: Client Information ── */}
                {step === 1 && (
                    <div className="card" style={{ padding: 28 }}>
                        <StepHeading step={2} icon={User} iconBg="#eff6ff" iconColor="#3b82f6"
                            title="Client Information" subtitle="Who is the mortgage for?" />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                            <Field label="Full Name" required error={fieldErrors.client_name}>
                                <TextInput value={form.client_name} onChange={v => set('client_name', v)} placeholder="Jane Tan" hasError={!!fieldErrors.client_name} />
                            </Field>
                            <Field label="Mobile Number" required error={fieldErrors.client_mobile}>
                                <TextInput value={form.client_mobile} onChange={v => set('client_mobile', v)} placeholder="+65 9123 4567" hasError={!!fieldErrors.client_mobile} />
                            </Field>
                            <Field label="Email" required error={fieldErrors.client_email}>
                                <TextInput value={form.client_email} onChange={v => set('client_email', v)} placeholder="jane@email.com" type="email" hasError={!!fieldErrors.client_email} />
                            </Field>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 28 }}>
                            <button type="button" onClick={handleBack} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ChevronLeft size={15} /> Back
                            </button>
                            <button type="button" onClick={handleNext} className="btn-emerald" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                Next <ChevronRight size={15} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 3: Mortgage Details (Progressive Reveal) ── */}
                {step === 2 && (
                    <div className="card" style={{ padding: 28 }}>
                        <StepHeading step={3} icon={Building2} iconBg="#fef3c7" iconColor="#d97706"
                            title="Mortgage Details"
                            subtitle="Each section opens as you complete the previous one." />

                        {/* Section A — Bank */}
                        <Field label="Bank" required>
                            <BankDropdown value={form.bank_id} onChange={handleBankChange} />
                        </Field>

                        {/* Section B — Case Category */}
                        {showCaseCategory && (
                            <div ref={refCaseCategory} style={{ scrollMarginTop: 16 }}>
                                <SectionDivider label="Case Type" />
                                <PillToggle
                                    options={[{ value: 'residential', label: 'Residential' }, { value: 'commercial', label: 'Commercial' }]}
                                    value={form.case_category}
                                    onChange={handleCategoryChange}
                                />
                            </div>
                        )}

                        {/* Section C — Banker */}
                        {showBanker && (
                            <div ref={refBanker} style={{ scrollMarginTop: 16 }}>
                                <SectionDivider label="Banker" />
                                {bankerList.length === 0 ? (
                                    <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
                                        No bankers listed for this bank / category combination.
                                    </p>
                                ) : (
                                    <select
                                        value={form.banker_name}
                                        onChange={e => handleBankerChange(e.target.value)}
                                        style={selectStyle}
                                    >
                                        <option value="">Select banker</option>
                                        {bankerList.map(name => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        )}

                        {/* Section D — Property Type */}
                        {showPropertyType && (
                            <div ref={refPropertyType} style={{ scrollMarginTop: 16 }}>
                                <SectionDivider label="Property Type" />
                                <select
                                    value={form.property_type}
                                    onChange={e => handlePropertyTypeChange(e.target.value)}
                                    style={selectStyle}
                                >
                                    <option value="">Select property type</option>
                                    {propertyTypes.map(pt => (
                                        <option key={pt} value={pt}>{pt}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Section E — Loan Fields */}
                        {showLoanFields && (
                            <div ref={refLoanFields} style={{ scrollMarginTop: 16 }}>
                                <SectionDivider label="Loan Details" />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <Field label="Loan Amount (S$)" required>
                                        <TextInput value={form.outstanding_loan_amount} onChange={v => set('outstanding_loan_amount', v)} placeholder="500000" type="number" />
                                    </Field>
                                    <Field label="Tenure (years)" required>
                                        <TextInput value={form.balance_tenure_months} onChange={v => set('balance_tenure_months', v)} placeholder="20" type="number" />
                                    </Field>
                                    <Field label="Subsidy Provided (S$)">
                                        <TextInput value={form.subsidy_amount} onChange={v => set('subsidy_amount', v)} placeholder="e.g. 2000" type="number" />
                                    </Field>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                        <Field label="Lock-in Period" required>
                                            <select value={form.lock_in_period} onChange={e => handleLockInChange(e.target.value)} style={selectStyle}>
                                                <option value="">Select years</option>
                                                {lockInOptions.map(y => (
                                                    <option key={y} value={y}>{y} {parseInt(y) === 1 ? 'year' : 'years'}</option>
                                                ))}
                                            </select>
                                        </Field>
                                        <Field label="Free Conversion">
                                            <select value={form.free_conversion} onChange={e => set('free_conversion', e.target.value)} style={selectStyle}>
                                                <option value="">Select years</option>
                                                {lockInOptions.map(y => (
                                                    <option key={y} value={y}>{y} {parseInt(y) === 1 ? 'year' : 'years'}</option>
                                                ))}
                                            </select>
                                        </Field>
                                    </div>
                                </div>

                                {commissionPreview && (
                                    <div style={{
                                        marginTop: 20, borderRadius: 12,
                                        background: 'linear-gradient(135deg, #059669 0%, #065f46 100%)',
                                        padding: '18px 22px',
                                    }}>
                                        <p style={{ fontSize: 10, fontWeight: 700, color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 12 }}>
                                            Estimated Commission
                                        </p>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px', alignItems: 'flex-end' }}>
                                            <div>
                                                <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 3 }}>Your Share (90%)</p>
                                                <p style={{ fontSize: 26, fontWeight: 800, color: 'white', letterSpacing: '-0.03em', lineHeight: 1 }}>
                                                    {formatCurrency(commissionPreview.agent)}
                                                </p>
                                            </div>
                                            <div>
                                                <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 3 }}>Gross</p>
                                                <p style={{ fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>
                                                    {formatCurrency(commissionPreview.gross)}
                                                </p>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.15)' }}>
                                            <CheckCircle2 size={12} color="#a7f3d0" />
                                            <span style={{ fontSize: 11, color: '#a7f3d0' }}>Estimate based on loan amount</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Section F — Package Details */}
                        {showPackage && (
                            <div ref={refPackage} style={{ scrollMarginTop: 16 }}>
                                <SectionDivider label="Package Details" />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <div>
                                        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 500 }}>Package Type</p>
                                        <PillToggle
                                            options={[{ value: 'fixed', label: 'Fixed' }, { value: 'floating', label: 'Floating' }]}
                                            value={form.package_type}
                                            onChange={handlePackageTypeChange}
                                        />
                                    </div>

                                    {form.package_type === 'fixed' && (
                                        <div>
                                            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 500 }}>
                                                Fixed for how many years?
                                            </p>
                                            <YearPills max={lockInNum} value={form.fixed_years} onChange={handleFixedYearsChange} />
                                        </div>
                                    )}

                                    {/* Year-by-year rate rows */}
                                    {showYearRates && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                            <p style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>Interest Rates by Year</p>
                                            {Array.from({ length: lockInNum }, (_, i) => {
                                                const isFixed = i < fixedYearsNum
                                                return (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', width: 44, flexShrink: 0 }}>
                                                            Yr {i + 1}
                                                        </span>
                                                        <div style={{ position: 'relative', flex: 1 }}>
                                                            <input
                                                                type="number"
                                                                value={form.year_rates[i] ?? ''}
                                                                onChange={e => setYearRate(i, e.target.value)}
                                                                placeholder="0.00"
                                                                style={{
                                                                    width: '100%', padding: '10px 14px', paddingRight: 36,
                                                                    fontSize: 14, borderRadius: 8,
                                                                    border: '1px solid #d1d5db', outline: 'none', color: '#0f172a',
                                                                }}
                                                                onFocus={e => { e.target.style.borderColor = '#059669'; e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)' }}
                                                                onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none' }}
                                                            />
                                                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>%</span>
                                                        </div>
                                                        {isFixed ? (
                                                            <span style={{ fontSize: 12, fontWeight: 700, color: '#052d4a', width: 100, flexShrink: 0 }}>Fixed</span>
                                                        ) : (
                                                            <select
                                                                value={form.floating_rate_type}
                                                                onChange={e => handleFloatingRateTypeChange(e.target.value as FloatingRateType)}
                                                                style={{ ...selectStyle, width: 110, flexShrink: 0, padding: '10px 10px', fontSize: 12 }}
                                                            >
                                                                {FLOATING_RATE_TYPES.map(rt => (
                                                                    <option key={rt} value={rt}>{rt}</option>
                                                                ))}
                                                            </select>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Section G — Date of Letter of Offer */}
                        {showLetterOfOffer && (
                            <div ref={refLetterOfOffer} style={{ scrollMarginTop: 16 }}>
                                <SectionDivider label="Letter of Offer" />
                                <Field label="Date of Letter of Offer">
                                    <input
                                        type="date"
                                        value={form.letter_of_offer_date}
                                        onChange={e => set('letter_of_offer_date', e.target.value)}
                                        style={{ ...selectStyle }}
                                        onFocus={e => { e.target.style.borderColor = '#059669'; e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)' }}
                                        onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none' }}
                                    />
                                </Field>
                            </div>
                        )}

                        {/* Nav */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
                            <button type="button" onClick={handleBack} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ChevronLeft size={15} /> Back
                            </button>
                            {step3Complete && (
                                <button type="button" onClick={handleNext} className="btn-emerald" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    Next <ChevronRight size={15} />
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Step 4: Review & Submit ── */}
                {step === 3 && (
                    <div className="card" style={{ padding: 28 }}>
                        <StepHeading step={4} icon={FileText} iconBg="#f5f3ff" iconColor="#7c3aed"
                            title="Review & Submit" subtitle="Confirm your details, choose your follow-up preference, then submit." />

                        {/* ── Client Details ── */}
                        <SummarySection title="Client Details">
                            <SummaryRow label="Name" value={form.client_name || '—'} />
                            <SummaryRow label="Mobile" value={form.client_mobile || '—'} />
                            <SummaryRow label="Email" value={form.client_email || '—'} />
                        </SummarySection>

                        {/* ── Bank & Banker Details ── */}
                        <SummarySection title="Bank & Banker Details">
                            <SummaryRow label="Case Type (Step 1)" value={form.case_type ? form.case_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—'} />
                            {bankName && <SummaryRow label="Bank" value={bankName} />}
                            {form.case_category && <SummaryRow label="Category" value={form.case_category === 'residential' ? 'Residential' : 'Commercial'} />}
                            {form.banker_name && <SummaryRow label="Banker" value={form.banker_name} />}
                            {form.property_type && <SummaryRow label="Property Type" value={form.property_type} />}
                        </SummarySection>

                        {/* ── Package Details ── */}
                        <SummarySection title="Package Details">
                            {form.outstanding_loan_amount && (
                                <SummaryRow label="Loan Amount" value={`S$${parseInt(form.outstanding_loan_amount).toLocaleString()}`} />
                            )}
                            {form.balance_tenure_months && <SummaryRow label="Tenure" value={`${form.balance_tenure_months} ${parseInt(form.balance_tenure_months) === 1 ? 'year' : 'years'}`} />}
                            {form.subsidy_amount && <SummaryRow label="Subsidy" value={`S$${parseInt(form.subsidy_amount).toLocaleString()}`} />}
                            {form.lock_in_period && <SummaryRow label="Lock-in Period" value={`${form.lock_in_period} ${form.lock_in_period === '1' ? 'year' : 'years'}`} />}
                            {form.free_conversion && <SummaryRow label="Free Conversion" value={`${form.free_conversion} ${form.free_conversion === '1' ? 'year' : 'years'}`} />}
                            {form.package_type && (
                                <SummaryRow label="Package Type" value={form.package_type === 'fixed' ? `Fixed (${form.fixed_years} yr fixed)` : 'Floating'} />
                            )}
                            {form.year_rates.length > 0 && form.year_rates.map((r, i) => {
                                const isFixed = i < fixedYearsNum
                                return (
                                    <SummaryRow
                                        key={i}
                                        label={`Year ${i + 1}`}
                                        value={isFixed ? `${r}% Fixed` : `${r}% + ${form.floating_rate_type}`}
                                    />
                                )
                            })}
                            {form.letter_of_offer_date && (
                                <SummaryRow label="Letter of Offer" value={new Date(form.letter_of_offer_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })} />
                            )}
                        </SummarySection>

                        {/* ── Current Commission ── */}
                        {commissionPreview && (
                            <div style={{
                                marginTop: 4, marginBottom: 20,
                                borderRadius: 12,
                                background: 'linear-gradient(135deg, #059669 0%, #065f46 100%)',
                                padding: '20px 24px',
                            }}>
                                <p style={{ fontSize: 10, fontWeight: 700, color: '#a7f3d0', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
                                    Indicative Commission Payable
                                </p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 32px', alignItems: 'flex-end', marginBottom: 14 }}>
                                    <div>
                                        <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 3 }}>Your Share (90%)</p>
                                        <p style={{ fontSize: 28, fontWeight: 800, color: 'white', letterSpacing: '-0.03em', lineHeight: 1 }}>
                                            {formatCurrency(commissionPreview.agent)}
                                        </p>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 3 }}>Gross (0.15% × loan)</p>
                                        <p style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>
                                            {formatCurrency(commissionPreview.gross)}
                                        </p>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 3 }}>TLC (10%)</p>
                                        <p style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.6)', lineHeight: 1 }}>
                                            {formatCurrency(commissionPreview.tlc)}
                                        </p>
                                    </div>
                                </div>
                                <p style={{ fontSize: 12, color: '#a7f3d0', fontStyle: 'italic' }}>
                                    If the bank will be paying a different % of revenue, highlight to us in the notes below.
                                </p>
                            </div>
                        )}

                        {/* ── Future Potential Commission ── */}
                        {futureProjection && (
                            <div style={{
                                marginBottom: 20, borderRadius: 12,
                                border: '1.5px solid #e0f2fe',
                                background: '#f0f9ff',
                                padding: '20px 24px',
                            }}>
                                <p style={{ fontSize: 10, fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 14 }}>
                                    Future Potential Commission (Refinancing)
                                </p>
                                {hasFloating && (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 14, padding: '10px 12px', background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa' }}>
                                        <span style={{ fontSize: 14 }}>⚠️</span>
                                        <p style={{ fontSize: 12, color: '#9a3412', lineHeight: 1.5 }}>
                                            As this package includes a floating rate, we use <strong>2.5% p.a.</strong> as a rough example to derive the estimated outstanding loan after lock-in.
                                        </p>
                                    </div>
                                )}
                                {!hasFloating && (
                                    <p style={{ fontSize: 12, color: '#0369a1', marginBottom: 14 }}>
                                        Based on your {form.lock_in_period}-year fixed package at an average of {avgFixedRate.toFixed(2)}% p.a.
                                    </p>
                                )}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 32px', alignItems: 'flex-end', marginBottom: 12 }}>
                                    <div>
                                        <p style={{ fontSize: 11, color: '#0369a1', marginBottom: 3 }}>Est. Remaining Balance</p>
                                        <p style={{ fontSize: 22, fontWeight: 800, color: '#0c4a6e', letterSpacing: '-0.02em', lineHeight: 1 }}>
                                            {formatCurrency(futureProjection.projectedRemainingBalance)}
                                        </p>
                                    </div>
                                    <div>
                                        <p style={{ fontSize: 11, color: '#0369a1', marginBottom: 3 }}>Gross Commission (0.15%)</p>
                                        <p style={{ fontSize: 17, fontWeight: 700, color: '#0c4a6e', lineHeight: 1 }}>
                                            {formatCurrency(futureProjection.projectedGrossCommission)}
                                        </p>
                                    </div>
                                </div>
                                {form.followup_preference && (
                                    <div style={{ borderTop: '1px solid #bae6fd', paddingTop: 12, marginTop: 4 }}>
                                        <p style={{ fontSize: 11, color: '#0369a1', marginBottom: 4 }}>Your Share ({form.followup_preference === 'self' ? '90%' : '30%'})</p>
                                        <p style={{ fontSize: 20, fontWeight: 800, color: '#059669', letterSpacing: '-0.02em' }}>
                                            {formatCurrency(futureProjection.projectedGrossCommission * (form.followup_preference === 'self' ? 0.9 : 0.3))}
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Follow-up Preference ── */}
                        <div style={{ marginBottom: 24 }}>
                            <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Follow-up Preference</p>
                            <p style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
                                How would you like to handle client follow-up at the end of the lock-in period?
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {[
                                    {
                                        value: 'self',
                                        title: 'I will follow up with this client myself',
                                        subtitle: 'TLC will send me a reminder at the end of the lock-in period.',
                                        split: '90% to you / 10% to TLC',
                                        splitColor: '#059669',
                                    },
                                    {
                                        value: 'tlc',
                                        title: 'I will inform the client that TLC will be following up',
                                        subtitle: 'TLC will contact the client directly at the end of the lock-in period.',
                                        split: '30% to you / 70% to TLC',
                                        splitColor: '#0284c7',
                                    },
                                ].map(opt => {
                                    const selected = form.followup_preference === opt.value
                                    return (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => set('followup_preference', opt.value as 'self' | 'tlc')}
                                            style={{
                                                textAlign: 'left', padding: '16px 18px', borderRadius: 10, cursor: 'pointer',
                                                border: `2px solid ${selected ? '#059669' : '#e2e8f0'}`,
                                                background: selected ? '#f0fdf4' : 'white',
                                                transition: 'all 0.15s', display: 'block', width: '100%',
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                        <div style={{
                                                            width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                                                            border: `2px solid ${selected ? '#059669' : '#d1d5db'}`,
                                                            background: selected ? '#059669' : 'white',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        }}>
                                                            {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'white' }} />}
                                                        </div>
                                                        <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{opt.title}</p>
                                                    </div>
                                                    <p style={{ fontSize: 12, color: '#64748b', paddingLeft: 24 }}>{opt.subtitle}</p>
                                                </div>
                                                <span style={{
                                                    fontSize: 11, fontWeight: 700, color: opt.splitColor,
                                                    background: selected ? (opt.value === 'self' ? '#dcfce7' : '#e0f2fe') : '#f8fafc',
                                                    border: `1px solid ${selected ? opt.splitColor + '40' : '#e2e8f0'}`,
                                                    padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap', flexShrink: 0,
                                                }}>
                                                    {opt.split}
                                                </span>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>

                        {/* ── Document upload ── */}
                        <div style={{ marginBottom: 24 }}>
                            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                                Document <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 500 }}>*</span>
                            </p>
                            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>Attach a Letter of Offer or supporting document.</p>
                            <DocumentUploader onFileSelect={setSelectedFile} selectedFile={selectedFile} />
                        </div>

                        {/* ── Notes ── */}
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
                                    color: '#0f172a', fontFamily: 'inherit',
                                }}
                                onFocus={e => { e.target.style.borderColor = '#059669'; e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)' }}
                                onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none' }}
                            />
                            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 5, textAlign: 'right' }}>{form.notes.length}/500</p>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
                            <button type="button" onClick={handleBack} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ChevronLeft size={15} /> Back
                            </button>
                            <button
                                type="submit"
                                disabled={submitting || !form.followup_preference}
                                className="btn-emerald btn-lg"
                                style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: (submitting || !form.followup_preference) ? 0.5 : 1 }}
                            >
                                {submitting ? <Spinner size="sm" color="white" label="Submitting…" /> : <><Check size={16} /> Submit Case</>}
                            </button>
                        </div>
                        <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 14 }}>
                            Our team will review your case within 1–2 business days.
                        </p>
                    </div>
                )}
            </form>
        </div>
    )
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                {title}
            </p>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {children}
            </div>
        </div>
    )
}

function SummaryRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <span style={{ fontSize: 12, color: '#64748b', minWidth: 130 }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: highlight ? 700 : 600, color: highlight ? '#059669' : '#0f172a' }}>{value}</span>
        </div>
    )
}
