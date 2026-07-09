'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import {
    ShoppingCart, RefreshCcw, Users, TrendingUp, Percent, MessageCircle, Calculator,
    ArrowRight, Check,
} from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'

const CASE_TYPES = [
    { label: 'Refinance', icon: RefreshCcw, accent: '#10b981' },
    { label: 'New Purchase', icon: ShoppingCart, accent: '#03a9e7' },
    { label: 'Decoupling', icon: Users, accent: '#8b5cf6' },
    { label: 'Equity Loan', icon: TrendingUp, accent: '#f59e0b' },
]

interface TourSlide {
    title: string
    description: string
    render?: 'cases'
    icon?: React.ElementType
    accent?: string
}

const TOUR_SLIDES: TourSlide[] = [
    {
        title: 'Manage every case type in one workflow',
        description: 'Refinance, purchase, decoupling, and equity-loan cases each have a guided step-by-step workflow that walks you through the numbers.',
        render: 'cases',
    },
    {
        title: 'Rates & auto-recommendation',
        description: 'Browse published bank packages and let Step 4 recommend the best fit using live SORA and your client’s loan details.',
        icon: Percent,
        accent: '#03a9e7',
    },
    {
        title: 'Knowledge Assistant',
        description: 'Ask a question in plain English and get an answer grounded strictly in TLC’s own knowledge base — never a guess.',
        icon: MessageCircle,
        accent: '#8b5cf6',
    },
    {
        title: 'Calculators',
        description: 'TDSR, BUC, amortization, and partial-repayment calculators are all one click away from the sidebar.',
        icon: Calculator,
        accent: '#f59e0b',
    },
]

type Step = 'profile' | 'tour'

function OnboardingInner() {
    const router = useRouter()
    const searchParams = useSearchParams()

    const [loading, setLoading] = useState(true)
    const [step, setStep] = useState<Step>('profile')
    const [slideIndex, setSlideIndex] = useState(0)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [form, setForm] = useState({ mobile: '', cea_registration_no: '', agency_name: '' })

    useEffect(() => {
        let active = true
        const run = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.replace('/insurance/login'); return }

            const { data: profile } = await supabase
                .from('profiles')
                .select('mobile, cea_registration_no, agency_name, onboarding')
                .eq('id', user.id)
                .single()
            if (!active || !profile) return

            setForm({
                mobile: profile.mobile ?? '',
                cea_registration_no: profile.cea_registration_no ?? '',
                agency_name: profile.agency_name ?? '',
            })

            const requestedStep = searchParams.get('step')
            if (requestedStep === 'tour' || (requestedStep !== 'profile' && profile.onboarding?.profile_completed)) {
                setStep('tour')
            }

            setLoading(false)
        }
        run()
        return () => { active = false }
    }, [router, searchParams])

    const patchOnboarding = async (body: Record<string, unknown>) => {
        await fetch('/api/insurance/onboarding', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
    }

    const saveProfile = async (markComplete: boolean) => {
        setSaving(true)
        setError(null)
        try {
            if (markComplete) {
                const { data: { user } } = await supabase.auth.getUser()
                if (user) {
                    const { error: updateError } = await supabase
                        .from('profiles')
                        .update({
                            mobile: form.mobile || null,
                            cea_registration_no: form.cea_registration_no || null,
                            agency_name: form.agency_name || null,
                        })
                        .eq('id', user.id)
                    if (updateError) throw updateError
                }
            }
            await patchOnboarding({ profile_completed: markComplete })
            setStep('tour')
        } catch (err: any) {
            setError(err.message || 'Failed to save your profile')
        }
        setSaving(false)
    }

    const finishTour = async (markComplete: boolean) => {
        setSaving(true)
        try {
            await patchOnboarding({ tour_completed: markComplete, complete: true })
            router.replace('/insurance/dashboard')
        } catch {
            setError('Failed to finish onboarding')
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)' }}>
                <Spinner size="md" color="#03a9e7" label="Loading…" />
            </div>
        )
    }

    return (
        <div
            style={{
                minHeight: '100dvh',
                background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: 'calc(48px + env(safe-area-inset-top)) 16px calc(48px + env(safe-area-inset-bottom))',
            }}
        >
            <div style={{ maxWidth: 480, width: '100%', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
                    {(['profile', 'tour'] as Step[]).map(s => (
                        <div key={s} style={{
                            width: 40, height: 4, borderRadius: 999,
                            background: s === step ? '#03a9e7' : (s === 'profile' && step === 'tour') ? '#93c5fd' : '#e2e8f0',
                        }} />
                    ))}
                </div>

                <div className="card-elevated" style={{ padding: '36px 32px' }}>
                    {error && (
                        <div style={{ marginBottom: 16 }}>
                            <InlineAlert type="error" message={error} onDismiss={() => setError(null)} />
                        </div>
                    )}

                    {step === 'profile' && (
                        <div>
                            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#052d4a', marginBottom: 6 }}>Complete your profile</h1>
                            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24 }}>
                                A few details clients and admin will see on your cases.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div>
                                    <label className="form-label">Mobile Number</label>
                                    <input
                                        type="tel"
                                        value={form.mobile}
                                        onChange={e => setForm({ ...form, mobile: e.target.value })}
                                        placeholder="+65 9123 4567"
                                        style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1px solid #d1d5db', outline: 'none', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">CEA Registration No.</label>
                                    <input
                                        type="text"
                                        value={form.cea_registration_no}
                                        onChange={e => setForm({ ...form, cea_registration_no: e.target.value })}
                                        placeholder="R012345A"
                                        style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1px solid #d1d5db', outline: 'none', boxSizing: 'border-box' }}
                                    />
                                </div>
                                <div>
                                    <label className="form-label">Agency Name</label>
                                    <input
                                        type="text"
                                        value={form.agency_name}
                                        onChange={e => setForm({ ...form, agency_name: e.target.value })}
                                        placeholder="The Loan Connection"
                                        style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1px solid #d1d5db', outline: 'none', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 28 }}>
                                <button type="button" onClick={() => saveProfile(false)} disabled={saving}
                                    style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                    Skip for now
                                </button>
                                <button
                                    type="button"
                                    onClick={() => saveProfile(true)}
                                    disabled={saving}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '11px 22px', borderRadius: 10, border: 'none',
                                        background: '#03a9e7', color: 'white', fontSize: 14, fontWeight: 600,
                                        cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                                    }}
                                >
                                    {saving ? 'Saving…' : <><span>Continue</span><ArrowRight size={16} /></>}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'tour' && (
                        <div>
                            {(() => {
                                const slide = TOUR_SLIDES[slideIndex]
                                return (
                                    <>
                                        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#052d4a', marginBottom: 10 }}>{slide.title}</h1>
                                        <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>{slide.description}</p>

                                        {slide.render === 'cases' ? (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
                                                {CASE_TYPES.map(({ label, icon: Icon, accent }) => (
                                                    <div key={label} style={{
                                                        display: 'flex', alignItems: 'center', gap: 10,
                                                        padding: '12px 14px', borderRadius: 12, background: `${accent}14`,
                                                        border: `1px solid ${accent}33`,
                                                    }}>
                                                        <Icon size={18} color={accent} />
                                                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>{label}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                width: 72, height: 72, borderRadius: 20, margin: '0 auto 8px',
                                                background: `${slide.accent}14`,
                                            }}>
                                                {slide.icon && <slide.icon size={32} color={slide.accent} />}
                                            </div>
                                        )}
                                    </>
                                )
                            })()}

                            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '20px 0' }}>
                                {TOUR_SLIDES.map((_, i) => (
                                    <div key={i} style={{
                                        width: i === slideIndex ? 18 : 6, height: 6, borderRadius: 999,
                                        background: i === slideIndex ? '#03a9e7' : '#e2e8f0', transition: 'width 0.15s',
                                    }} />
                                ))}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <button type="button" onClick={() => finishTour(false)} disabled={saving}
                                    style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                                    Skip for now
                                </button>
                                {slideIndex < TOUR_SLIDES.length - 1 ? (
                                    <button
                                        type="button"
                                        onClick={() => setSlideIndex(i => i + 1)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '11px 22px', borderRadius: 10, border: 'none',
                                            background: '#03a9e7', color: 'white', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                                        }}
                                    >
                                        <span>Next</span><ArrowRight size={16} />
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => finishTour(true)}
                                        disabled={saving}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            padding: '11px 22px', borderRadius: 10, border: 'none',
                                            background: '#03a9e7', color: 'white', fontSize: 14, fontWeight: 600,
                                            cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
                                        }}
                                    >
                                        {saving ? 'Finishing…' : <><Check size={16} /><span>Go to dashboard</span></>}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function InsuranceOnboarding() {
    return <Suspense><OnboardingInner /></Suspense>
}
