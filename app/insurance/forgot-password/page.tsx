'use client'

import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'

export default function InsuranceForgotPassword() {
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
                        Contact your administrator to reset it.
                    </p>
                </div>

                <div className="card-elevated" style={{ padding: '36px 32px', textAlign: 'center' }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: '50%',
                        background: '#fef3c7', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 20px',
                    }}>
                        <ShieldAlert size={28} color="#d97706" />
                    </div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 10 }}>
                        Password resets are managed by your admin
                    </p>
                    <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, marginBottom: 28 }}>
                        Ask your administrator to reset your password. They will set a temporary password for you — you can then change it from your <strong>Profile</strong> page after logging in.
                    </p>
                    <Link
                        href="/insurance/login"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#03a9e7', fontWeight: 600, textDecoration: 'none' }}
                    >
                        <ArrowLeft size={14} /> Back to sign in
                    </Link>
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
