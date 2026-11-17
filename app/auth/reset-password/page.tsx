'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Lock, CheckCircle, AlertCircle } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { Suspense } from 'react'

type PageState = 'loading' | 'ready' | 'success' | 'invalid'

function ResetPasswordInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [pageState, setPageState] = useState<PageState>('loading')
    const [password, setPassword] = useState('')
    const [confirm, setConfirm] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [redirectPath, setRedirectPath] = useState('/property/login')

    useEffect(() => {
        // If the callback route flagged an error (invalid/expired code)
        if (searchParams.get('error') === 'invalid') {
            setPageState('invalid')
            return
        }

        // Verify an active recovery session exists (set by the callback route)
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (!session) {
                setPageState('invalid')
                return
            }

            // Determine which portal to redirect back to after reset
            const { data: profile } = await supabase
                .from('profiles')
                .select('app_type')
                .eq('id', session.user.id)
                .single()
            setRedirectPath(profile?.app_type === 'insurance' ? '/insurance/login' : '/property/login')
            setPageState('ready')
        })
    }, [searchParams])

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (password.length < 6) {
            setError('Password must be at least 6 characters.')
            return
        }
        if (password !== confirm) {
            setError('Passwords do not match.')
            return
        }

        setLoading(true)
        const { error: updateError } = await supabase.auth.updateUser({ password })
        setLoading(false)

        if (updateError) {
            setError(updateError.message)
        } else {
            await supabase.auth.signOut()
            setPageState('success')
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
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <img
                        src="/brand/tlc-logo.png"
                        alt="TLC"
                        style={{ width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px', display: 'block', boxShadow: '0 4px 12px rgba(5,45,74,0.15)' }}
                    />
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#052d4a', letterSpacing: '-0.02em', marginBottom: 6 }}>
                        {pageState === 'success' ? 'Password updated' : 'Set new password'}
                    </h1>
                </div>

                <div className="card-elevated" style={{ padding: '36px 32px' }}>

                    {/* Loading */}
                    {pageState === 'loading' && (
                        <div style={{ textAlign: 'center', padding: '16px 0' }}>
                            <Spinner size="md" color="#059669" label="Verifying…" />
                        </div>
                    )}

                    {/* Invalid / expired */}
                    {pageState === 'invalid' && (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: '#fef2f2', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 20px',
                            }}>
                                <AlertCircle size={28} color="#dc2626" />
                            </div>
                            <p style={{ fontSize: 15, color: '#0f172a', fontWeight: 600, marginBottom: 8 }}>
                                Link expired or invalid
                            </p>
                            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
                                This reset link has expired or already been used. Request a new one from the login page.
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <button
                                    onClick={() => router.push('/property/forgot-password')}
                                    className="btn-emerald btn-lg"
                                    style={{ width: '100%', justifyContent: 'center' }}
                                >
                                    Basic & Starter — Request New Link
                                </button>
                                <button
                                    onClick={() => router.push('/insurance/forgot-password')}
                                    style={{
                                        width: '100%', padding: '12px 24px', borderRadius: 10,
                                        border: '1px solid #d1d5db', background: 'white',
                                        color: '#374151', fontSize: 15, fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Premium — Request New Link
                                </button>
                            </div>
                        </div>
                    )}

                    {/* New password form */}
                    {pageState === 'ready' && (
                        <>
                            {error && (
                                <div style={{
                                    padding: '10px 14px', borderRadius: 9,
                                    background: '#fef2f2', border: '1px solid #fecaca',
                                    color: '#991b1b', fontSize: 13, fontWeight: 500, marginBottom: 20,
                                }}>
                                    {error}
                                </div>
                            )}

                            <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                                <div>
                                    <label className="form-label">New Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <Lock size={16} color="#94a3b8"
                                            style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                                        />
                                        <input
                                            required
                                            type="password"
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            placeholder="At least 6 characters"
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
                                    <label className="form-label">Confirm New Password</label>
                                    <div style={{ position: 'relative' }}>
                                        <Lock size={16} color="#94a3b8"
                                            style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
                                        />
                                        <input
                                            required
                                            type="password"
                                            value={confirm}
                                            onChange={e => setConfirm(e.target.value)}
                                            placeholder="Re-enter your new password"
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
                                        ? <Spinner size="sm" color="white" label="Updating…" />
                                        : 'Update Password'
                                    }
                                </button>
                            </form>
                        </>
                    )}

                    {/* Success */}
                    {pageState === 'success' && (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: '#d1fae5', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 20px',
                            }}>
                                <CheckCircle size={28} color="#059669" />
                            </div>
                            <p style={{ fontSize: 15, color: '#0f172a', fontWeight: 600, marginBottom: 8 }}>
                                Password updated successfully
                            </p>
                            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
                                Your password has been changed. You can now sign in with your new password.
                            </p>
                            <button
                                onClick={() => router.push(redirectPath)}
                                className="btn-emerald btn-lg"
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                Go to Sign In
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function ResetPassword() {
    return (
        <Suspense fallback={null}>
            <ResetPasswordInner />
        </Suspense>
    )
}
