'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Case, AssistantData } from '@/lib/types'
import { ArrowLeft, Save, ChevronRight, AlertTriangle, CheckCircle2, Clock, DollarSign, Activity } from 'lucide-react'

// Define the step logic
const STEPS = [
    { id: 0, title: 'Current Reality', icon: Clock },
    { id: 1, title: 'Penalties', icon: AlertTriangle },
    { id: 2, title: 'Timeline', icon: Activity },
    { id: 3, title: 'Preferences', icon: DollarSign },
    { id: 4, title: 'Summary', icon: CheckCircle2 },
]

export default function SalesAssistantPage() {
    const router = useRouter()
    const params = useParams()
    const caseId = params?.id as string

    const [loading, setLoading] = useState(true)
    const [caseData, setCaseData] = useState<Case | null>(null)
    const [currentStep, setCurrentStep] = useState(0)

    // Assistant State
    const [assistantData, setAssistantData] = useState<AssistantData>({
        reality: { interest_type: '', lock_in_expiry: '', is_expired: false },
        penalties: { subsidy_received: '', clawback_remaining: '' },
        timeline: { sell_plan: '', income_changes: '' },
        preferences: { rate_preference: '', payment_sensitivity: '' }
    })

    useEffect(() => {
        if (caseId) loadCase()
    }, [caseId])

    const loadCase = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from('cases')
            .select('*')
            .eq('id', caseId)
            .single()

        if (error || !data) {
            alert('Failed to load case')
            router.push('/dashboard/cases')
            return
        }

        // ENTRY CHECK: Only Refi allowed
        if (data.case_type !== 'Refinancing' && data.case_type !== 'Equity Loan') {
            alert('Sales Assistant is only available for Refinancing or Equity Loan cases.')
            router.back()
            return
        }

        setCaseData(data)

        // Pre-fill or Resume
        if (data.sales_assistant_data) {
            setAssistantData(data.sales_assistant_data)
        } else {
            // Auto-fill from case data if fresh
            const now = new Date()
            const lockInDate = data.lock_in_end_date ? new Date(data.lock_in_end_date) : null
            const isExpired = lockInDate ? lockInDate < now : false

            const daysRemaining = lockInDate && !isExpired
                ? Math.ceil((lockInDate.getTime() - now.getTime()) / (1000 * 3600 * 24))
                : undefined

            setAssistantData(prev => ({
                ...prev,
                reality: {
                    ...prev.reality,
                    lock_in_expiry: data.lock_in_end_date || 'Unknown',
                    is_expired: isExpired,
                    days_remaining: daysRemaining
                }
            }))
        }
        setLoading(false)
    }

    const saveProgress = async () => {
        if (!caseId) return
        await supabase
            .from('cases')
            .update({ sales_assistant_data: assistantData })
            .eq('id', caseId)
    }

    const handleNext = () => {
        saveProgress()
        if (currentStep < STEPS.length - 1) {
            setCurrentStep(prev => prev + 1)
        }
    }

    const handleBack = () => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1)
        }
    }

    const updateState = (section: keyof AssistantData, field: string, value: any) => {
        setAssistantData(prev => ({
            ...prev,
            [section]: {
                ...(prev[section] as any),
                [field]: value
            }
        }))
    }

    if (loading) return <div style={{ padding: 40 }}>Loading Assistant...</div>

    const StepIcon = STEPS[currentStep].icon

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '100px' }}>
            {/* Header */}
            <div style={{ marginBottom: '24px' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        background: 'none', border: 'none', color: '#64748b',
                        display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: 12
                    }}
                >
                    <ArrowLeft size={16} /> Exit Assistant
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#052d4a', margin: 0 }}>
                        {STEPS[currentStep].title}
                    </h1>
                    <div style={{ fontSize: '14px', color: '#64748b', fontWeight: '500' }}>
                        Step {currentStep + 1} of {STEPS.length}
                    </div>
                </div>
                {/* Progress Bar */}
                <div style={{ height: 4, background: '#e2e8f0', marginTop: 16, borderRadius: 2 }}>
                    <div style={{
                        width: `${((currentStep + 1) / STEPS.length) * 100}%`,
                        height: '100%',
                        background: '#03a9e7',
                        borderRadius: 2,
                        transition: 'width 0.3s ease'
                    }} />
                </div>
            </div>

            {/* Main Content Area */}
            <div className="card" style={{ padding: '32px', minHeight: '400px' }}>

                {/* SECTION 1: REALITY */}
                {currentStep === 0 && (
                    <div className="animate-fade-in">
                        <h2 className="section-title">Let's check the current loan.</h2>

                        <div className="info-block">
                            <span className="label">Current Bank</span>
                            <span className="value">{caseData?.current_bank || 'Not specified'}</span>
                        </div>

                        <div className="info-block">
                            <span className="label">Loan Amount</span>
                            <span className="value">{caseData?.existing_loan_amount ? `$${caseData.existing_loan_amount.toLocaleString()}` : 'Not specified'}</span>
                        </div>

                        <div style={{ marginTop: 24 }}>
                            <label className="input-label">Current Interest Type?</label>
                            <div className="option-grid">
                                {['Fixed', 'Floating'].map(opt => (
                                    <OptionButton
                                        key={opt}
                                        selected={assistantData.reality.interest_type === opt}
                                        onClick={() => updateState('reality', 'interest_type', opt)}
                                    >
                                        {opt}
                                    </OptionButton>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginTop: 24, padding: 16, background: '#f8fafc', borderRadius: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <Clock size={20} color="#64748b" />
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>LOCK-IN END DATE</div>
                                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                                        {assistantData.reality.lock_in_expiry !== 'Unknown'
                                            ? new Date(assistantData.reality.lock_in_expiry).toLocaleDateString()
                                            : 'Unknown'}
                                    </div>
                                </div>
                            </div>
                            {/* Logic Checks */}
                            {assistantData.reality.is_expired ? (
                                <AlertBox type="success" message="Lock-in has expired. No penalty expected." />
                            ) : assistantData.reality.days_remaining ? (
                                <AlertBox
                                    type={assistantData.reality.days_remaining > 180 ? 'warning' : 'info'}
                                    message={
                                        assistantData.reality.days_remaining > 180
                                            ? `Still ${Math.ceil(assistantData.reality.days_remaining / 30)} months away. Early refinancing may incur penalty.`
                                            : `Ending in ${Math.ceil(assistantData.reality.days_remaining / 30)} months. Good time to review.`
                                    }
                                />
                            ) : null}
                        </div>
                    </div>
                )}

                {/* SECTION 2: PENALTIES */}
                {currentStep === 1 && (
                    <div className="animate-fade-in">
                        <h2 className="section-title">Check for hidden costs.</h2>

                        <div className="question-block">
                            <label className="input-label">Any subsidy previously received?</label>
                            <div className="option-grid">
                                {['Yes', 'No', 'Not Sure'].map(opt => (
                                    <OptionButton
                                        key={opt}
                                        selected={assistantData.penalties.subsidy_received === opt}
                                        onClick={() => updateState('penalties', 'subsidy_received', opt)}
                                    >
                                        {opt}
                                    </OptionButton>
                                ))}
                            </div>
                            {assistantData.penalties.subsidy_received === 'Yes' && (
                                <AlertBox type="warning" message="Check for clawback clauses (usually 3 years)." />
                            )}
                        </div>

                        <div className="question-block">
                            <label className="input-label">Any clawback period remaining?</label>
                            <div className="option-grid">
                                {['Yes', 'No', 'Not Sure'].map(opt => (
                                    <OptionButton
                                        key={opt}
                                        selected={assistantData.penalties.clawback_remaining === opt}
                                        onClick={() => updateState('penalties', 'clawback_remaining', opt)}
                                    >
                                        {opt}
                                    </OptionButton>
                                ))}
                            </div>
                            {assistantData.penalties.clawback_remaining === 'Yes' && (
                                <AlertBox type="danger" message="Refinancing now will trigger a refund of legal subsidies/cash." />
                            )}
                        </div>
                    </div>
                )}

                {/* SECTION 3: TIMELINE */}
                {currentStep === 2 && (
                    <div className="animate-fade-in">
                        <h2 className="section-title">Align with future plans.</h2>

                        <div className="question-block">
                            <label className="input-label">When does the client plan to sell?</label>
                            <div className="option-grid">
                                {['Within 2 Years', '2-5 Years', 'Long Term'].map(opt => (
                                    <OptionButton
                                        key={opt}
                                        selected={assistantData.timeline.sell_plan === opt}
                                        onClick={() => updateState('timeline', 'sell_plan', opt)}
                                    >
                                        {opt}
                                    </OptionButton>
                                ))}
                            </div>
                            {assistantData.timeline.sell_plan === 'Within 2 Years' && (
                                <AlertBox type="warning" message="Avoid packages with long lock-ins or clawbacks." />
                            )}
                        </div>

                        <div className="question-block">
                            <label className="input-label">Any major income changes expected?</label>
                            <div className="option-grid">
                                {['Yes', 'No', 'Unsure'].map(opt => (
                                    <OptionButton
                                        key={opt}
                                        selected={assistantData.timeline.income_changes === opt}
                                        onClick={() => updateState('timeline', 'income_changes', opt)}
                                    >
                                        {opt}
                                    </OptionButton>
                                ))}
                            </div>
                            {assistantData.timeline.income_changes === 'Yes' && (
                                <AlertBox type="info" message="Flexibility might be more important than the absolute lowest rate." />
                            )}
                        </div>
                    </div>
                )}

                {/* SECTION 4: PREFERENCES */}
                {currentStep === 3 && (
                    <div className="animate-fade-in">
                        <h2 className="section-title">Risk & Style.</h2>

                        <div className="question-block">
                            <label className="input-label">Rate Preference</label>
                            <div className="option-grid">
                                {['Fixed', 'Floating', 'Unsure'].map(opt => (
                                    <OptionButton
                                        key={opt}
                                        selected={assistantData.preferences.rate_preference === opt}
                                        onClick={() => updateState('preferences', 'rate_preference', opt)}
                                    >
                                        {opt}
                                    </OptionButton>
                                ))}
                            </div>
                            {assistantData.preferences.rate_preference === 'Fixed' && (
                                <AlertBox type="success" message="Fixed rate discussion is relevant." />
                            )}
                        </div>

                        <div className="question-block">
                            <label className="input-label">Payment Sensitivity</label>
                            <div className="option-grid">
                                {['Stable', 'Flexible'].map(opt => (
                                    <OptionButton
                                        key={opt}
                                        selected={assistantData.preferences.payment_sensitivity === opt}
                                        onClick={() => updateState('preferences', 'payment_sensitivity', opt)}
                                    >
                                        {opt === 'Stable' ? 'Wants predictable payments' : 'Can tolerate variation'}
                                    </OptionButton>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* SECTION 5: SUMMARY */}
                {currentStep === 4 && (
                    <div className="animate-fade-in">
                        <div style={{ textAlign: 'center', marginBottom: 24 }}>
                            <div style={{ display: 'inline-flex', padding: 16, borderRadius: '50%', background: '#fef9c3', color: '#a16207', marginBottom: 16 }}>
                                <CheckCircle2 size={48} />
                            </div>
                            <h2 className="section-title" style={{ textAlign: 'center' }}>Analysis Complete</h2>
                            <p style={{ color: '#64748b' }}>Here is the reasoning summary based on the facts.</p>
                        </div>

                        <div style={{ background: '#f8fafc', padding: 24, borderRadius: 12, border: '1px solid #e2e8f0' }}>
                            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Refinancing Consideration Summary</h3>

                            <ul style={{ paddingLeft: 20, color: '#334155', lineHeight: 1.6, marginBottom: 24 }}>
                                <li><strong>Current Bank:</strong> {caseData?.current_bank || 'Unknown'}</li>
                                <li>
                                    <strong>Lock-in:</strong> {assistantData.reality.is_expired ? 'Expired' : `Ends in ~${Math.ceil((assistantData.reality.days_remaining || 0) / 30)} months`}
                                </li>
                                <li><strong>Clawback Risk:</strong> {assistantData.penalties.clawback_remaining === 'Yes' ? 'HIGH' : 'Low/None'}</li>
                                <li><strong>Timeline:</strong> {assistantData.timeline.sell_plan === 'Long Term' ? 'Holding Long Term' : `Selling ${assistantData.timeline.sell_plan}`}</li>
                                <li><strong>preference:</strong> {assistantData.preferences.rate_preference} Rates</li>
                            </ul>

                            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#052d4a', marginBottom: 8 }}>Implications:</h4>
                            <p style={{ color: '#0f172a', fontSize: 15, lineHeight: 1.5 }}>
                                {generateSummary(assistantData)}
                            </p>
                        </div>

                        <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center' }}>
                            <button
                                onClick={async () => {
                                    // Save summary to remarks potentially?
                                    const summary = generateSummary(assistantData)
                                    // Could append to case remarks logic here if requested
                                    alert('Summary copied to clipboard (simulated)')
                                }}
                                className="btn-outline"
                            >
                                Copy to Clipboard
                            </button>
                            <button
                                onClick={() => router.push(`/dashboard/cases/${caseId}`)}
                                className="btn-primary"
                            >
                                Finish & Return to Case
                            </button>
                        </div>
                    </div>
                )}

            </div>

            {/* Navigation Footer */}
            {currentStep < 4 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 32 }}>
                    <button
                        onClick={handleBack}
                        disabled={currentStep === 0}
                        style={{
                            padding: '12px 24px', borderRadius: 8, border: '1px solid #cbd5e1',
                            background: 'white', color: '#64748b', cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
                            opacity: currentStep === 0 ? 0.5 : 1
                        }}
                    >
                        Back
                    </button>
                    <button
                        onClick={handleNext}
                        className="btn-primary"
                        style={{ padding: '12px 32px', display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                        Next <ChevronRight size={18} />
                    </button>
                </div>
            )}

            <style jsx global>{`
                .section-title {
                    font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 24px;
                }
                .input-label {
                    display: block; font-size: 14px; font-weight: 600; color: #334155; margin-bottom: 12px;
                }
                .option-grid {
                    display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;
                }
                .info-block {
                    display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding: 12px 0;
                }
                .info-block .label { color: #64748b; font-size: 14px; }
                .info-block .value { color: #0f172a; font-weight: 600; font-size: 15px; }
                .question-block { margin-top: 32px; }
            `}</style>
        </div>
    )
}

function OptionButton({ children, selected, onClick }: any) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '16px',
                borderRadius: '8px',
                border: selected ? '2px solid #03a9e7' : '1px solid #cbd5e1',
                background: selected ? '#e0f2fe' : 'white',
                color: selected ? '#0284c7' : '#475569',
                fontWeight: selected ? '600' : '500',
                cursor: 'pointer',
                transition: 'all 0.2s',
                fontSize: '15px'
            }}
        >
            {children}
        </button>
    )
}

function AlertBox({ type, message }: { type: 'warning' | 'info' | 'success' | 'danger', message: string }) {
    const colors = {
        warning: { bg: '#fff7ed', text: '#c2410c', border: '#fdba74' },
        info: { bg: '#eff6ff', text: '#1d4ed8', border: '#93c5fd' },
        success: { bg: '#f0fdf4', text: '#15803d', border: '#86efac' },
        danger: { bg: '#fef2f2', text: '#b91c1c', border: '#fca5a5' }
    }
    const style = colors[type]
    return (
        <div style={{
            marginTop: 12, padding: '12px 16px', borderRadius: 6,
            background: style.bg, color: style.text, border: `1px solid ${style.border}`,
            fontSize: '14px', lineHeight: 1.4
        }}>
            {message}
        </div>
    )
}

function generateSummary(data: AssistantData) {
    // Basic logic generator
    let advice = []

    if (data.reality.days_remaining && data.reality.days_remaining > 180) {
        advice.push("Refinancing now may incur penalties; waiting closer to lock-in end could be beneficial.")
    } else {
        advice.push("Lock-in is ending soon or expired; this is an appropriate time to review options.")
    }

    if (data.penalties.clawback_remaining === 'Yes') {
        advice.push("However, high attention must be paid to the clawback clause to avoid cash refunds.")
    }

    if (data.timeline.sell_plan === 'Within 2 Years') {
        advice.push("Since the client plans to sell soon, avoid 2-year lock-in packages purely for rate.")
    }

    if (data.preferences.rate_preference === 'Fixed') {
        advice.push("Given the preference for stability, prioritize fixed rate packages even if slightly higher than floating.")
    }

    return advice.join(" ")
}
