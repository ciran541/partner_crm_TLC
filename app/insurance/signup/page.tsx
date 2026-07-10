'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, User, ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import LegalConsentModal from '@/components/shared/LegalConsentModal'
import Spinner from '@/components/shared/Spinner'
import { insuranceTerms, insurancePrivacy } from '@/lib/legal/insuranceLegalContent'
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '@/lib/legal/consentVersions'

type TokenState = 'checking' | 'invalid' | 'valid'

function InsuranceSignupInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const token = searchParams.get('token') ?? ''

    const [tokenState, setTokenState] = useState<TokenState>('checking')
    const [emailLocked, setEmailLocked] = useState(false)

    const [form, setForm] = useState({
        name: '',
        email: '',
        password: '',
        confirmPassword: '',
        termsAccepted: false,
        privacyAccepted: false,
    })
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [activeModal, setActiveModal] = useState<'terms' | 'privacy' | null>(null)

    useEffect(() => {
        if (!token) {
            setTokenState('invalid')
            return
        }
        let active = true
        fetch(`/api/insurance/signup?token=${encodeURIComponent(token)}`)
            .then(res => res.json())
            .then(data => {
                if (!active) return
                if (!data.valid) {
                    setTokenState('invalid')
                    return
                }
                setForm(f => ({
                    ...f,
                    name: data.invited_name ?? '',
                    email: data.invited_email ?? '',
                }))
                setEmailLocked(!!data.invited_email)
                setTokenState('valid')
            })
            .catch(() => { if (active) setTokenState('invalid') })
        return () => { active = false }
    }, [token])

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        if (form.password !== form.confirmPassword) {
            setError("Passwords don't match")
            setLoading(false)
            return
        }

        try {
            const res = await fetch('/api/insurance/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    email: form.email,
                    password: form.password,
                    name: form.name,
                    terms_accepted: form.termsAccepted,
                    privacy_accepted: form.privacyAccepted,
                    terms_version: CURRENT_TERMS_VERSION,
                    privacy_version: CURRENT_PRIVACY_VERSION,
                }),
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Failed to sign up')
            }

            router.push('/insurance/login?registered=true')
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
    }

    const agreedCount = [form.termsAccepted, form.privacyAccepted].filter(Boolean).length
    const allAgreed = form.termsAccepted && form.privacyAccepted
    const canSubmit = allAgreed && !loading

    const inputStyle = {
        width: '100%', padding: '11px 14px 11px 42px',
        fontSize: 14, borderRadius: 10,
        border: '1px solid #d1d5db', background: 'white',
        outline: 'none', color: '#0f172a',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxSizing: 'border-box' as const,
    }

    function handleInputFocus(e: React.FocusEvent<HTMLInputElement>) {
        e.target.style.borderColor = '#03a9e7'
        e.target.style.boxShadow = '0 0 0 3px rgba(3,169,231,0.12)'
    }
    function handleInputBlur(e: React.FocusEvent<HTMLInputElement>) {
        e.target.style.borderColor = '#d1d5db'
        e.target.style.boxShadow = 'none'
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
            <div style={{ maxWidth: 440, width: '100%', margin: '0 auto' }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <img
                        src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                        alt="TLC"
                        style={{ width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px', display: 'block', boxShadow: '0 4px 12px rgba(5,45,74,0.15)' }}
                    />
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#052d4a', letterSpacing: '-0.02em', marginBottom: 6 }}>
                        Create your account
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>Join TLC&apos;s Insurance Agent network.</p>
                </div>

                {tokenState === 'checking' && (
                    <div className="card-elevated" style={{ padding: '48px 32px', display: 'flex', justifyContent: 'center' }}>
                        <Spinner size="md" color="#03a9e7" label="Checking your invite link…" />
                    </div>
                )}

                {tokenState === 'invalid' && (
                    <div className="card-elevated" style={{ padding: '36px 32px', textAlign: 'center' }}>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#052d4a', marginBottom: 8 }}>
                            This invite link is invalid or has expired
                        </h2>
                        <p style={{ fontSize: 14, color: '#64748b' }}>
                            Please contact your TLC admin for a new invite link.
                        </p>
                    </div>
                )}

                {tokenState === 'valid' && (
                    <div>
                        <div className="card-elevated" style={{ padding: '36px 32px' }}>
                            <form style={{ display: 'flex', flexDirection: 'column', gap: 18 }} onSubmit={handleSignup}>
                                {error && (
                                    <div style={{
                                        padding: '10px 14px', borderRadius: 9,
                                        background: '#fef2f2', border: '1px solid #fecaca',
                                        color: '#991b1b', fontSize: 13, fontWeight: 500,
                                    }}>
                                        {error}
                                    </div>
                                )}

                                <div>
                                    <label className="form-label">Full Name</label>
                                    <div style={{ position: 'relative' }}>
                                        <User size={16} color="#94a3b8" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                        <input required type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                            placeholder="Jane Doe" style={inputStyle} onFocus={handleInputFocus} onBlur={handleInputBlur} />
                                    </div>
                                </div>

                                <div>
                                    <label className="form-label">Email Address</label>
                                    <div style={{ position: 'relative' }}>
                                        <Mail size={16} color="#94a3b8" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                        <input required type="email" value={form.email} disabled={emailLocked}
                                            onChange={e => setForm({ ...form, email: e.target.value })}
                                            placeholder="jane@example.com"
                                            style={{ ...inputStyle, ...(emailLocked ? { background: '#f8fafc', color: '#64748b', cursor: 'not-allowed' } : {}) }}
                                            onFocus={handleInputFocus} onBlur={handleInputBlur} />
                                    </div>
                                </div>

                                <div>
                                    <label className="form-label">Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <Lock size={16} color="#94a3b8" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                        <input required type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                                            placeholder="Create a strong password" minLength={8} style={inputStyle} onFocus={handleInputFocus} onBlur={handleInputBlur} />
                                    </div>
                                </div>

                                <div>
                                    <label className="form-label">Confirm Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <Lock size={16} color="#94a3b8" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                                        <input required type="password" value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                                            placeholder="Repeat password" style={inputStyle} onFocus={handleInputFocus} onBlur={handleInputBlur} />
                                    </div>
                                </div>

                                <div style={{ paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                        <p style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Legal Agreements</p>
                                        <span style={{
                                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 9999,
                                            background: allAgreed ? '#dbeafe' : '#f1f5f9',
                                            color: allAgreed ? '#03a9e7' : '#64748b',
                                        }}>
                                            {agreedCount} of 2 accepted
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                        {([
                                            { key: 'terms' as const, label: 'Terms & Conditions', accepted: form.termsAccepted },
                                            { key: 'privacy' as const, label: 'Privacy Policy', accepted: form.privacyAccepted },
                                        ]).map(({ key, label, accepted }) => (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => setActiveModal(key)}
                                                className="pressable"
                                                style={{
                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                    padding: '12px 14px', borderRadius: 10,
                                                    border: `1px solid ${accepted ? '#bfdbfe' : '#e2e8f0'}`,
                                                    background: accepted ? '#eff6ff' : 'white',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    {accepted
                                                        ? <CheckCircle2 size={20} color="#03a9e7" style={{ transition: 'transform 0.15s' }} />
                                                        : <Circle size={20} color="#d1d5db" />
                                                    }
                                                    <span style={{ fontSize: 14, fontWeight: 600, color: accepted ? '#03a9e7' : '#374151' }}>{label}</span>
                                                </div>
                                                <span style={{ fontSize: 11, fontWeight: 700, color: '#03a9e7', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                                    {accepted ? 'Review' : 'Read →'}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={!canSubmit}
                                    style={{
                                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        padding: '12px 24px', borderRadius: 10, border: 'none',
                                        background: '#03a9e7', color: 'white', fontSize: 15, fontWeight: 600,
                                        opacity: !canSubmit ? 0.4 : 1, cursor: !canSubmit ? 'not-allowed' : 'pointer',
                                        transition: 'background 0.15s',
                                    }}
                                >
                                    {loading ? 'Creating Account…' : <><span>Sign Up</span><ArrowRight size={16} /></>}
                                </button>
                            </form>

                            <div style={{ marginTop: 24, textAlign: 'center' }}>
                                <p style={{ fontSize: 14, color: '#64748b' }}>
                                    Already have an account?{' '}
                                    <Link href="/insurance/login" style={{ color: '#03a9e7', fontWeight: 700, textDecoration: 'none' }}>
                                        Sign in
                                    </Link>
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <LegalConsentModal
                isOpen={activeModal === 'terms'}
                title="Terms & Conditions"
                content={insuranceTerms}
                alreadyAccepted={form.termsAccepted}
                onClose={() => setActiveModal(null)}
                onAccept={() => {
                    setForm({ ...form, termsAccepted: true })
                    setActiveModal(null)
                }}
            />
            <LegalConsentModal
                isOpen={activeModal === 'privacy'}
                title="Privacy Policy"
                content={insurancePrivacy}
                alreadyAccepted={form.privacyAccepted}
                onClose={() => setActiveModal(null)}
                onAccept={() => {
                    setForm({ ...form, privacyAccepted: true })
                    setActiveModal(null)
                }}
            />
        </div>
    )
}

export default function InsuranceSignup() {
    return <Suspense><InsuranceSignupInner /></Suspense>
}
