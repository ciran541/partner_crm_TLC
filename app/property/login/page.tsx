'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { Lock, Mail, ArrowRight } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'

const REASON_MESSAGES: Record<string, string> = {
    suspended: 'Your account is pending activation. Please contact your admin.',
}

function PropertyLoginInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const reason = searchParams.get('reason')
        if (reason && REASON_MESSAGES[reason]) {
            setError(REASON_MESSAGES[reason])
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
                .select('app_type, status')
                .eq('id', data.user.id)
                .single()

            if (!profile || profile.app_type !== 'property') {
                await supabase.auth.signOut()
                throw new Error('This login is for Property Agents only.')
            }

            if (profile.status === 'disabled') {
                await supabase.auth.signOut()
                throw new Error('Your account is pending activation. Please contact your admin.')
            }

            await fetch('/api/auth/register-session', { method: 'POST' })

            router.push('/property/dashboard')
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
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
                        Welcome back
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>Property Agent Portal — sign in to continue.</p>
                </div>

                {/* Card */}
                <div className="card-elevated" style={{ padding: '36px 32px' }}>
                    {error && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '10px 14px', borderRadius: 9,
                            background: '#fef2f2', border: '1px solid #fecaca',
                            color: '#991b1b', fontSize: 13, fontWeight: 500, marginBottom: 20,
                        }}>
                            {error}
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
                                        e.target.style.borderColor = '#059669'
                                        e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'
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
                                        e.target.style.borderColor = '#059669'
                                        e.target.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.12)'
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
                            className="btn-emerald btn-lg"
                            style={{ width: '100%', justifyContent: 'center', opacity: loading ? 0.75 : 1 }}
                        >
                            {loading
                                ? <Spinner size="sm" color="white" label="Signing in…" />
                                : <><span>Sign In</span><ArrowRight size={16} /></>
                            }
                        </button>
                    </form>

                    <div style={{ marginTop: 24, textAlign: 'center' }}>
                        <p style={{ fontSize: 14, color: '#64748b' }}>
                            Don&apos;t have an account?{' '}
                            <Link href="/property/signup" style={{ color: '#059669', fontWeight: 700, textDecoration: 'none' }}>
                                Sign up now
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function PropertyLogin() {
    return <Suspense><PropertyLoginInner /></Suspense>
}
