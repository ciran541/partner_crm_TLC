'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { Mail, ArrowLeft, CheckCircle } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'

export default function InsuranceForgotPassword() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [sent, setSent] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
        })

        setLoading(false)

        if (resetError) {
            setError(resetError.message)
        } else {
            setSent(true)
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
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <img
                        src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                        alt="TLC"
                        style={{ width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px', display: 'block', boxShadow: '0 4px 12px rgba(5,45,74,0.15)' }}
                    />
                    <h1 style={{ fontSize: 26, fontWeight: 800, color: '#052d4a', letterSpacing: '-0.02em', marginBottom: 6 }}>
                        Reset your password
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>
                        {sent ? 'Check your inbox for the reset link.' : "Enter your email and we'll send you a reset link."}
                    </p>
                </div>

                <div className="card-elevated" style={{ padding: '36px 32px' }}>
                    {sent ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: '#dbeafe', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 20px',
                            }}>
                                <CheckCircle size={28} color="#03a9e7" />
                            </div>
                            <p style={{ fontSize: 15, color: '#0f172a', fontWeight: 600, marginBottom: 8 }}>
                                Reset link sent
                            </p>
                            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28 }}>
                                We sent a password reset link to <strong>{email}</strong>. Check your spam folder if you don&apos;t see it.
                            </p>
                            <Link
                                href="/insurance/login"
                                style={{ color: '#03a9e7', fontWeight: 600, fontSize: 14, textDecoration: 'none' }}
                            >
                                Back to sign in
                            </Link>
                        </div>
                    ) : (
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

                            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
                                        ? <Spinner size="sm" color="white" label="Sending…" />
                                        : 'Send Reset Link'
                                    }
                                </button>
                            </form>

                            <div style={{ marginTop: 24, textAlign: 'center' }}>
                                <Link
                                    href="/insurance/login"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#64748b', textDecoration: 'none' }}
                                >
                                    <ArrowLeft size={14} /> Back to sign in
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}
