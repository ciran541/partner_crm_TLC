'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { CaseType } from '@/lib/types'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import { refreshCases } from '@/lib/insurance/useCases'
import { ArrowLeft, Zap, RefreshCcw, ShoppingCart, Users, TrendingUp, Scale } from 'lucide-react'

const CASE_TYPES: { type: CaseType; icon: React.ElementType; description: string }[] = [
    { type: 'Refinancing',  icon: RefreshCcw,   description: 'Switch to a better rate' },
    { type: 'Purchase',     icon: ShoppingCart,  description: 'New property purchase' },
    { type: 'Decouple',     icon: Users,         description: 'Remove a co-borrower' },
    { type: 'Equity Loan',  icon: TrendingUp,    description: 'Unlock property equity' },
    { type: 'Divorce',      icon: Scale,         description: 'Settlement restructuring' },
]

const isRefiOrEquity = (t: CaseType) => t === 'Refinancing' || t === 'Equity Loan'

export default function NewCasePage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [openWorkflow, setOpenWorkflow] = useState(false)

    const [caseType, setCaseType] = useState<CaseType>('Refinancing')
    const [clientName, setClientName] = useState('')
    const [clientMobile, setClientMobile] = useState('')
    const [clientEmail, setClientEmail] = useState('')
    const [loanSize, setLoanSize] = useState('')
    const [existingLoanAmount, setExistingLoanAmount] = useState('')
    const [currentBank, setCurrentBank] = useState('')
    const [lockInEndDate, setLockInEndDate] = useState('')
    const [propertyType, setPropertyType] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/insurance/login'); return }

            const payload: Record<string, unknown> = {
                case_type: caseType,
                client_name: clientName.trim() || null,
                client_mobile: clientMobile.trim() || null,
                client_email: clientEmail.trim() || null,
                stage: 'Touched Base',
                created_by: user.id,
            }

            if (isRefiOrEquity(caseType)) {
                payload.existing_loan_amount = existingLoanAmount ? parseFloat(existingLoanAmount) : null
                payload.current_bank = currentBank || null
                payload.lock_in_end_date = lockInEndDate || null
            } else {
                payload.loan_size = loanSize ? parseFloat(loanSize) : null
                payload.property_type = propertyType || null
            }

            const { data, error: insertError } = await supabase
                .from('cases')
                .insert(payload)
                .select()
                .single()

            if (insertError) throw new Error(insertError.message)

            // Keep the shared cases cache (dashboard / list) in sync with the new case.
            refreshCases()

            if (openWorkflow && data.case_type === 'Refinancing') {
                router.push(`/insurance/dashboard/cases/${data.id}?tab=workflow`)
            } else {
                router.push(`/insurance/dashboard/cases/${data.id}`)
            }
        } catch (err: any) {
            setError(err.message ?? 'An unexpected error occurred')
            setLoading(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            {/* Header */}
            <div>
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 font-medium mb-3 transition-colors"
                >
                    <ArrowLeft size={15} /> Back to Cases
                </button>
                <h1 className="ios-page-title">New Case</h1>
                <p className="page-subtitle">Cases start at <strong>Touched Base</strong>. All additional details can be filled in after creation.</p>
            </div>

            {error && <InlineAlert type="error" message={error} onDismiss={() => setError(null)} />}

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Case Type */}
                <div className="card p-5 space-y-3">
                    <p className="text-sm font-semibold text-slate-700">Case Type <span className="text-red-400">*</span></p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {CASE_TYPES.map(({ type, icon: Icon, description }) => (
                            <button
                                key={type}
                                type="button"
                                onClick={() => setCaseType(type)}
                                className={`flex flex-col items-start gap-1.5 p-3.5 rounded-xl border text-left transition-all ${
                                    caseType === type
                                        ? 'border-[#03a9e7] bg-sky-50 shadow-sm'
                                        : 'border-slate-200 bg-white hover:border-slate-300'
                                }`}
                            >
                                <Icon size={18} className={caseType === type ? 'text-[#03a9e7]' : 'text-slate-400'} />
                                <div>
                                    <p className={`text-sm font-semibold leading-tight ${caseType === type ? 'text-[#052d4a]' : 'text-slate-700'}`}>{type}</p>
                                    <p className="text-xs text-slate-400 mt-0.5 leading-tight">{description}</p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Client Information */}
                <div className="card p-5 space-y-4">
                    <p className="text-sm font-semibold text-slate-700">Client Information</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Full Name</label>
                            <input
                                type="text"
                                value={clientName}
                                onChange={e => setClientName(e.target.value)}
                                placeholder="e.g. John Tan"
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Mobile</label>
                            <input
                                type="tel"
                                value={clientMobile}
                                onChange={e => setClientMobile(e.target.value)}
                                placeholder="+65 9123 4567"
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Email</label>
                            <input
                                type="email"
                                value={clientEmail}
                                onChange={e => setClientEmail(e.target.value)}
                                placeholder="client@email.com"
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                            />
                        </div>
                    </div>
                </div>

                {/* Case-type-specific fields */}
                <div className="card p-5 space-y-4">
                    <p className="text-sm font-semibold text-slate-700">
                        {isRefiOrEquity(caseType) ? 'Existing Loan Details' : 'Purchase Details'}
                    </p>

                    {isRefiOrEquity(caseType) ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="sm:col-span-2">
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Current Bank</label>
                                <InsuranceBankDropdown value={currentBank} onChange={setCurrentBank} placeholder="Select current bank…" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Existing Loan Amount</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">$</span>
                                    <input
                                        type="number"
                                        value={existingLoanAmount}
                                        onChange={e => setExistingLoanAmount(e.target.value)}
                                        placeholder="0"
                                        min="0"
                                        className="w-full pl-7 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Lock-in End Date</label>
                                <input
                                    type="date"
                                    value={lockInEndDate}
                                    onChange={e => setLockInEndDate(e.target.value)}
                                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Property Type</label>
                                <select
                                    value={propertyType}
                                    onChange={e => setPropertyType(e.target.value)}
                                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                                >
                                    <option value="">Select type…</option>
                                    <option value="HDB">HDB</option>
                                    <option value="Private Condo">Private Condo</option>
                                    <option value="Landed">Landed</option>
                                    <option value="EC">EC (Executive Condo)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Estimated Loan Amount</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">$</span>
                                    <input
                                        type="number"
                                        value={loanSize}
                                        onChange={e => setLoanSize(e.target.value)}
                                        placeholder="0"
                                        min="0"
                                        className="w-full pl-7 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={loading}
                        onClick={() => setOpenWorkflow(false)}
                        className="btn-primary px-6 py-2.5 flex items-center gap-2"
                    >
                        {loading && !openWorkflow
                            ? <Spinner size="sm" color="white" label="Creating…" />
                            : 'Create Case'
                        }
                    </button>

                    {caseType === 'Refinancing' && (
                        <button
                            type="submit"
                            disabled={loading}
                            onClick={() => setOpenWorkflow(true)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#03a9e7] text-[#03a9e7] text-sm font-semibold hover:bg-sky-50 transition-colors"
                        >
                            {loading && openWorkflow
                                ? <Spinner size="sm" color="#03a9e7" label="Creating…" />
                                : <><Zap size={16} /> Create & Open Workflow</>
                            }
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => router.back()}
                        disabled={loading}
                        className="btn-ghost px-5 py-2.5 text-sm"
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    )
}
