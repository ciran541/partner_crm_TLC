'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'

export default function GlobalErrorBoundary({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error('Unhandled app error:', error)
    }, [error])

    return (
        <div
            style={{
                minHeight: '100dvh',
                background: 'linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '48px 16px',
                textAlign: 'center',
            }}
        >
            <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: '#fef2f2', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 20,
            }}>
                <AlertTriangle size={28} color="#dc2626" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#052d4a', marginBottom: 8 }}>
                Something went wrong
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', maxWidth: 380, marginBottom: 28, lineHeight: 1.6 }}>
                An unexpected error occurred. Your data is safe — try again, and contact support if this keeps happening.
            </p>
            <button
                onClick={reset}
                style={{
                    padding: '12px 28px', borderRadius: 10, border: 'none',
                    background: '#03a9e7', color: 'white', fontSize: 14, fontWeight: 600,
                    cursor: 'pointer',
                }}
            >
                Try again
            </button>
        </div>
    )
}
