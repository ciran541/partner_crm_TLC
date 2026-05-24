'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserPlus, Mail, Lock, User, ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import LegalConsentModal from '@/components/shared/LegalConsentModal'

const dummyTerms = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Property Agent Platform – Terms & Conditions</h2>
        <p className="text-xs text-slate-500">Last Updated: May 22, 2026</p>
        <p className="text-slate-600">
            Welcome to TLC Property Agent Platform (“Platform”), operated by The Loan Connection (TLC).
        </p>
        <p className="text-slate-600">
            By creating an account or using this platform, you agree to these Terms & Conditions.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Eligibility</h3>
        <p className="text-slate-600">You must:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Be at least 18 years old</li>
            <li>Provide accurate registration details</li>
            <li>Use the platform only for legitimate business-related mortgage/refinance submissions</li>
            <li>Be authorized to submit information related to your clients or cases</li>
        </ul>
        <p className="text-slate-600">TLC may suspend or terminate accounts that violate these terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. Platform Purpose</h3>
        <p className="text-slate-600">This platform allows approved property agents to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Submit refinance-related cases</li>
            <li>Upload supporting documents</li>
            <li>Track commission-related activity</li>
            <li>View recurring earning opportunities</li>
            <li>Track lock-in follow-up information</li>
        </ul>
        <p className="text-slate-600">TLC may modify platform features at any time.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Account Responsibility</h3>
        <p className="text-slate-600">You are responsible for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Maintaining login confidentiality</li>
            <li>Protecting your password</li>
            <li>All activity under your account</li>
            <li>Promptly notifying TLC of unauthorized access</li>
        </ul>
        <p className="text-slate-600">Do not share accounts.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Case Submission Accuracy</h3>
        <p className="text-slate-600">You agree that all submitted:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>client information</li>
            <li>refinance details</li>
            <li>uploaded documents</li>
            <li>LO (Letter of Offer)</li>
            <li>commission-related data</li>
        </ul>
        <p className="text-slate-600">must be accurate and lawful.</p>
        <p className="text-slate-600">False, misleading, or unauthorized submissions may result in suspension.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Document Uploads</h3>
        <p className="text-slate-600">You may upload:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>PDF files</li>
            <li>JPEG/PNG images</li>
            <li>supporting mortgage/refinance documents</li>
        </ul>
        <p className="text-slate-600">You must not upload:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>malicious files</li>
            <li>illegal content</li>
            <li>unrelated personal data</li>
            <li>copyrighted material without permission</li>
        </ul>
        <p className="text-slate-600">TLC may remove content.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Commission & Earnings</h3>
        <p className="text-slate-600">
            Displayed earnings, commissions, or recurring opportunities are for operational tracking.
        </p>
        <p className="text-slate-600">Final payout or confirmation may depend on:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>bank verification</li>
            <li>refinance completion</li>
            <li>internal review</li>
            <li>approval conditions</li>
        </ul>
        <p className="text-slate-600">Displayed values may be updated.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Platform Availability</h3>
        <p className="text-slate-600">TLC does not guarantee uninterrupted availability.</p>
        <p className="text-slate-600">Maintenance, updates, outages, or technical issues may occur.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">8. Acceptable Use</h3>
        <p className="text-slate-600">You must not:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>misuse the platform</li>
            <li>attempt unauthorized access</li>
            <li>interfere with system integrity</li>
            <li>scrape data</li>
            <li>upload malware</li>
            <li>impersonate another user</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">9. Account Suspension</h3>
        <p className="text-slate-600">TLC may suspend, restrict, or terminate accounts for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>fraud</li>
            <li>abuse</li>
            <li>security risk</li>
            <li>policy violation</li>
            <li>misuse</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">10. Limitation of Liability</h3>
        <p className="text-slate-600">TLC is not liable for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>indirect losses</li>
            <li>data interruption</li>
            <li>third-party banking delays</li>
            <li>missed commission opportunities caused by external parties</li>
            <li>service outages</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">11. Changes to Terms</h3>
        <p className="text-slate-600">TLC may update these Terms at any time.</p>
        <p className="text-slate-600">Continued use of the platform means acceptance of revised terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">12. Contact</h3>
        <p className="text-slate-600">Questions:</p>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)

const dummyPrivacy = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Property Agent Platform – Privacy Policy</h2>
        <p className="text-xs text-slate-500">Last Updated: May 22, 2026</p>
        <p className="text-slate-600">The Loan Connection (“TLC”) respects your privacy.</p>
        <p className="text-slate-600">This Privacy Policy explains how we collect, use, and protect information.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Information We Collect</h3>
        
        <p className="font-semibold text-slate-700 mt-2">Account Information</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Full name</li>
            <li>Email address</li>
            <li>Login credentials</li>
            <li>Agent profile information</li>
        </ul>

        <p className="font-semibold text-slate-700 mt-2">Case Information</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Refinance case details</li>
            <li>Loan-related information</li>
            <li>Commission-related tracking</li>
        </ul>

        <p className="font-semibold text-slate-700 mt-2">Uploaded Documents</p>
        <p className="text-slate-600">May include:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Letter of Offer</li>
            <li>PDF/JPEG supporting documents</li>
        </ul>

        <p className="font-semibold text-slate-700 mt-2">Technical Information</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>device/browser information</li>
            <li>IP address</li>
            <li>timestamps</li>
            <li>usage activity</li>
            <li>login events</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. How We Use Data</h3>
        <p className="text-slate-600">We use data to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>create/manage accounts</li>
            <li>process refinance-related workflows</li>
            <li>verify submitted cases</li>
            <li>track commissions</li>
            <li>manage recurring follow-up opportunities</li>
            <li>improve platform security</li>
            <li>audit platform activity</li>
            <li>send operational notifications</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Legal/Business Basis</h3>
        <p className="text-slate-600">We process information to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>provide services</li>
            <li>maintain operational records</li>
            <li>protect platform security</li>
            <li>comply with business/legal obligations</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Data Sharing</h3>
        <p className="text-slate-600">TLC may share limited data with:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>internal staff</li>
            <li>authorized platform administrators</li>
            <li>banking or operational partners (when required for verification)</li>
            <li>technical service providers</li>
        </ul>
        <p className="text-slate-600">We do not sell personal data.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Document Handling</h3>
        <p className="text-slate-600">Uploaded documents may be stored for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>verification</li>
            <li>audit</li>
            <li>operational tracking</li>
            <li>compliance</li>
        </ul>
        <p className="text-slate-600">Access is restricted.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Security</h3>
        <p className="text-slate-600">We take reasonable steps to protect:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>user accounts</li>
            <li>uploaded files</li>
            <li>stored records</li>
            <li>access permissions</li>
        </ul>
        <p className="text-slate-600">However, no system is 100% secure.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Retention</h3>
        <p className="text-slate-600">We may retain records for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>business operations</li>
            <li>audits</li>
            <li>commission tracking</li>
            <li>legal/compliance requirements</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">8. Your Rights</h3>
        <p className="text-slate-600">Where applicable, users may request:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>account updates</li>
            <li>corrections</li>
            <li>access requests</li>
            <li>deletion requests (subject to operational/legal constraints)</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">9. Cookies / Technical Tracking</h3>
        <p className="text-slate-600">The platform may use:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>authentication cookies</li>
            <li>session handling</li>
            <li>basic analytics</li>
            <li>security logs</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">10. Changes to Privacy Policy</h3>
        <p className="text-slate-600">TLC may update this Privacy Policy.</p>
        <p className="text-slate-600">Continued platform use indicates acceptance.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">11. Contact</h3>
        <p className="text-slate-600">For privacy questions:</p>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)

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
                    terms_version: '1.0',
                    privacy_version: '1.0',
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
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #f8fafc 0%, #ecfdf5 100%)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                padding: '48px 16px',
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
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '12px 14px', borderRadius: 10,
                                            border: `1px solid ${accepted ? '#a7f3d0' : '#e2e8f0'}`,
                                            background: accepted ? '#f0fdf4' : 'white',
                                            cursor: 'pointer', transition: 'all 0.15s',
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
