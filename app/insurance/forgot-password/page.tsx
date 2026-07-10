'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mail, ArrowRight, CheckCircle2 } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'

export default function InsuranceForgotPassword() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [sent, setSent] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        }).catch(() => {})
        setLoading(false)
        setSent(true)
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
                        Forgot your password?
                    </h1>
                    <p style={{ fontSize: 14, color: '#64748b' }}>
                        Enter your email and we'll send you a reset link.
                    </p>
                </div>

                <div className="card-elevated" style={{ padding: '36px 32px', textAlign: sent ? 'center' : 'left' }}>
                    {sent ? (
                        <>
                            <div style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: '#d1fae5', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                margin: '0 auto 20px',
                            }}>
                                <CheckCircle2 size={28} color="#059669" />
                            </div>
                            <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>
                                Check your email
                            </p>
                            <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 28 }}>
                                If <strong>{email}</strong> is registered, we've sent a password reset link to it.
                            </p>
                        </>
                    ) : (
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            <div>
                                <label className="form-label">Email Address</label>
                                <div style={{ position: 'relative' }}>
                                    <Mail size={16} color="#94a3b8" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
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
                                            boxSizing: 'border-box',
                                        }}
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    padding: '12px 24px', borderRadius: 10, border: 'none',
                                    background: loading ? '#7dd3f8' : '#03a9e7', color: 'white', fontSize: 15, fontWeight: 600,
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {loading
                                    ? <Spinner size="sm" color="white" label="Sending…" />
                                    : <><span>Send Reset Link</span><ArrowRight size={16} /></>
                                }
                            </button>
                        </form>
                    )}

                    <div style={{ marginTop: 24, textAlign: 'center' }}>
                        <Link
                            href="/insurance/login"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#03a9e7', fontWeight: 600, textDecoration: 'none' }}
                        >
                            <ArrowLeft size={14} /> Back to sign in
                        </Link>
                    </div>
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
