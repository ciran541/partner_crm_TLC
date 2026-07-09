'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Mail, Lock, User, ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import LegalConsentModal from '@/components/shared/LegalConsentModal'
import Spinner from '@/components/shared/Spinner'

const insuranceTerms = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Insurance Agent Platform – Terms & Conditions</h2>
        <p className="text-xs text-slate-500">Last Updated: July 7, 2026</p>
        <p className="text-slate-600">
            Welcome to TLC's Insurance Agent Platform (&ldquo;Platform&rdquo;), operated by The Loan Connection (TLC).
        </p>
        <p className="text-slate-600">
            By creating an account or using this platform, you agree to these Terms & Conditions.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Eligibility</h3>
        <p className="text-slate-600">You must:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Be at least 18 years old</li>
            <li>Provide accurate registration details</li>
            <li>Access this platform only via an invite issued to you by TLC</li>
            <li>Use the platform only for legitimate mortgage-advisory client work</li>
        </ul>
        <p className="text-slate-600">TLC may suspend or terminate accounts that violate these terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. Platform Purpose</h3>
        <p className="text-slate-600">This platform allows approved insurance agents to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Manage refinancing, purchase, decoupling, and equity-loan client cases</li>
            <li>Browse mortgage rate packages and rate recommendations</li>
            <li>Use the knowledge assistant and calculators</li>
            <li>Track commission-related activity</li>
        </ul>
        <p className="text-slate-600">TLC may modify platform features at any time.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Account Responsibility</h3>
        <p className="text-slate-600">You are responsible for maintaining login confidentiality, protecting your password, and all activity under your account. Do not share accounts.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Case Accuracy</h3>
        <p className="text-slate-600">All client information, case details, and commission-related data you submit must be accurate and lawful. False or unauthorized submissions may result in suspension.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Acceptable Use</h3>
        <p className="text-slate-600">You must not misuse the platform, attempt unauthorized access, scrape data, or impersonate another user.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Changes to Terms</h3>
        <p className="text-slate-600">TLC may update these Terms at any time. Continued use of the platform means acceptance of revised terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Contact</h3>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)

const insurancePrivacy = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Insurance Agent Platform – Privacy Policy</h2>
        <p className="text-xs text-slate-500">Last Updated: July 7, 2026</p>
        <p className="text-slate-600">The Loan Connection (&ldquo;TLC&rdquo;) respects your privacy and explains here how we collect, use, and protect information.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Information We Collect</h3>
        <p className="text-slate-600">Account information (name, email, login credentials, agent profile details), case information (mortgage case details, workflow answers, commission tracking), and technical information (device/browser, IP address, login events).</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. How We Use Data</h3>
        <p className="text-slate-600">To create/manage accounts, process client workflows, track commissions, improve platform security, and send operational notifications.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Data Sharing</h3>
        <p className="text-slate-600">TLC may share limited data with internal staff, authorized administrators, and banking/operational partners when required for verification. We do not sell personal data.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Security</h3>
        <p className="text-slate-600">We take reasonable steps to protect user accounts and stored records, though no system is 100% secure.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Your Rights</h3>
        <p className="text-slate-600">Where applicable, you may request account updates, corrections, access, or deletion, subject to operational/legal constraints.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Changes to Privacy Policy</h3>
        <p className="text-slate-600">TLC may update this Privacy Policy. Continued platform use indicates acceptance.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Contact</h3>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)

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
                    terms_version: '1.0',
                    privacy_version: '1.0',
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
