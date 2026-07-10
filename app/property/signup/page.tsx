'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, Mail, Lock, User, ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import LegalConsentModal from '@/components/shared/LegalConsentModal'
import { propertyTerms as dummyTerms, propertyPrivacy as dummyPrivacy } from '@/lib/legal/propertyLegalContent'
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from '@/lib/legal/consentVersions'

export default function PropertySignup() {
    const router = useRouter()
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
            const res = await fetch('/api/property/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
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

            router.push('/property/login?registered=true')
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
        e.target.style.borderColor = '#059669'
        e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'
    }
    function handleInputBlur(e: React.FocusEvent<HTMLInputElement>) {
        e.target.style.borderColor = '#d1d5db'
        e.target.style.boxShadow = 'none'
    }

    return (
        <div
            style={{
                minHeight: '100dvh',
                background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: 'calc(48px + env(safe-area-inset-top)) 16px calc(48px + env(safe-area-inset-bottom))',
            }}
        >
            <div style={{ maxWidth: 440, width: '100%', margin: '0 auto' }}>
                {/* Logo & title */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <img
                        src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                        alt="TLC"
                        style={{ width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px', display: 'block', boxShadow: '0 4px 12px rgba(5,45,74,0.15)' }}
                    />
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#052d4a', letterSpacing: '-0.02em', marginBottom: 6 }}>
                        Create your account
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>Join TLC&apos;s Property Agent network.</p>
                </div>

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
                                <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                                    placeholder="jane@example.com" style={inputStyle} onFocus={handleInputFocus} onBlur={handleInputBlur} />
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
                                    background: allAgreed ? '#d1fae5' : '#f1f5f9',
                                    color: allAgreed ? '#065f46' : '#64748b',
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
                                            border: `1px solid ${accepted ? '#a7f3d0' : '#e2e8f0'}`,
                                            background: accepted ? '#f0fdf4' : 'white',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            {accepted
                                                ? <CheckCircle2 size={20} color="#059669" style={{ transition: 'transform 0.15s' }} />
                                                : <Circle size={20} color="#d1d5db" />
                                            }
                                            <span style={{ fontSize: 14, fontWeight: 600, color: accepted ? '#065f46' : '#374151' }}>{label}</span>
                                        </div>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                            {accepted ? 'Review' : 'Read →'}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="btn-emerald btn-lg"
                            style={{ width: '100%', justifyContent: 'center', opacity: !canSubmit ? 0.4 : 1, cursor: !canSubmit ? 'not-allowed' : 'pointer' }}
                        >
                            {loading ? 'Creating Account…' : <><span>Sign Up</span><ArrowRight size={16} /></>}
                        </button>
                    </form>

                    <div style={{ marginTop: 24, textAlign: 'center' }}>
                        <p style={{ fontSize: 14, color: '#64748b' }}>
                            Already have an account?{' '}
                            <Link href="/property/login" style={{ color: '#059669', fontWeight: 700, textDecoration: 'none' }}>
                                Sign in
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
            </div>

            {/* Legal Modals */}
            <LegalConsentModal
                isOpen={activeModal === 'terms'}
                title="Terms & Conditions"
                content={dummyTerms}
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
                content={dummyPrivacy}
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
