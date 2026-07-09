'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { Lock, Mail, ArrowRight } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import { saveLinkedAccount } from '@/lib/auth/accountSwitcher'

const REASON_MESSAGES: Record<string, string> = {
    suspended: 'Your account is pending activation. Please contact your admin.',
}

function InsuranceLoginInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const reason = searchParams.get('reason')
        if (reason && REASON_MESSAGES[reason]) {
            setError(REASON_MESSAGES[reason])
        }
        if (searchParams.get('registered') === 'true') {
            setSuccess('Account created — you can sign in now.')
        }
    }, [searchParams])

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        try {
            const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
            if (signInError) throw signInError
            if (!data.user) throw new Error('No user returned')

            const { data: profile } = await supabase
                .from('profiles')
                .select('app_type, status, role, name')
                .eq('id', data.user.id)
                .single()

            if (!profile || profile.app_type !== 'insurance') {
                await supabase.auth.signOut()
                throw new Error('This login is for Insurance Agents only.')
            }

            if (profile.status === 'disabled') {
                await supabase.auth.signOut()
                throw new Error('Your account is pending activation. Please contact your admin.')
            }

            await fetch('/api/auth/register-session', { method: 'POST' })

            if (data.session) {
                saveLinkedAccount({
                    userId: data.user.id,
                    email: data.user.email ?? email,
                    name: profile.name ?? null,
                    role: profile.role,
                    appType: profile.app_type,
                    accessToken: data.session.access_token,
                    refreshToken: data.session.refresh_token,
                })
            }

            router.push('/insurance/dashboard')
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
    }

    return (
        <div
            style={{
                minHeight: '100vh',
                background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
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
                        Welcome back
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>Insurance Agent Portal — sign in to continue.</p>
                </div>

                {/* Card */}
                <div className="card-elevated" style={{ padding: '36px 32px' }}>
                    {error && (
                        <div style={{ marginBottom: 20 }}>
                            <InlineAlert type="error" message={error} onDismiss={() => setError(null)} />
                        </div>
                    )}

                    {success && (
                        <div style={{ marginBottom: 20 }}>
                            <InlineAlert type="success" message={success} onDismiss={() => setSuccess(null)} />
                        </div>
                    )}

                    <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div>
                            <label className="form-label">Email Address</label>
                            <div style={{ position: 'relative' }}>
                                <Mail
                                    size={16}
                                    color="#94a3b8"
                                    style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                                />
                                <input
                                    required
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="Enter your email"
                                    style={{
                                        width: '100%', padding: '11px 14px 11px 42px',
                                        fontSize: 14, borderRadius: 10,
                                        border: '1px solid #d1d5db', background: 'white',
                                        outline: 'none', color: '#0f172a',
                                        transition: 'border-color 0.15s, box-shadow 0.15s',
                                        boxSizing: 'border-box',
                                    }}
                                    onFocus={e => {
                                        e.target.style.borderColor = '#03a9e7'
                                        e.target.style.boxShadow = '0 0 0 3px rgba(3,169,231,0.12)'
                                    }}
                                    onBlur={e => {
                                        e.target.style.borderColor = '#d1d5db'
                                        e.target.style.boxShadow = 'none'
                                    }}
                                />
                            </div>
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <label className="form-label" style={{ margin: 0 }}>Password</label>
                                <Link href="/insurance/forgot-password" style={{ fontSize: 13, color: '#03a9e7', fontWeight: 500, textDecoration: 'none' }}>
                                    Forgot password?
                                </Link>
                            </div>
                            <div style={{ position: 'relative' }}>
                                <Lock
                                    size={16}
                                    color="#94a3b8"
                                    style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                                />
                                <input
                                    required
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Enter your password"
                                    style={{
                                        width: '100%', padding: '11px 14px 11px 42px',
                                        fontSize: 14, borderRadius: 10,
                                        border: '1px solid #d1d5db', background: 'white',
                                        outline: 'none', color: '#0f172a',
                                        transition: 'border-color 0.15s, box-shadow 0.15s',
                                        boxSizing: 'border-box',
                                    }}
                                    onFocus={e => {
                                        e.target.style.borderColor = '#03a9e7'
                                        e.target.style.boxShadow = '0 0 0 3px rgba(3,169,231,0.12)'
                                    }}
                                    onBlur={e => {
                                        e.target.style.borderColor = '#d1d5db'
                                        e.target.style.boxShadow = 'none'
                                    }}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                padding: '12px 24px',
                                borderRadius: 10,
                                border: 'none',
                                background: loading ? '#7dd3f8' : '#03a9e7',
                                color: 'white',
                                fontSize: 15,
                                fontWeight: 600,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                transition: 'background 0.15s',
                            }}
                        >
                            {loading
                                ? <Spinner size="sm" color="white" label="Signing in…" />
                                : <><span>Sign In</span><ArrowRight size={16} /></>
                            }
                        </button>
                    </form>
                </div>

                <div style={{ marginTop: 24, textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: '#94a3b8' }}>
                        &copy; {new Date().getFullYear()} The Loan Connection. All rights reserved.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default function InsuranceLogin() {
    return <Suspense><InsuranceLoginInner /></Suspense>
}
