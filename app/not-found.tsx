import Link from 'next/link'
import { SearchX } from 'lucide-react'

export default function NotFound() {
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
                background: '#eff6ff', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 20,
            }}>
                <SearchX size={28} color="#03a9e7" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#052d4a', marginBottom: 8 }}>
                Page not found
            </h1>
            <p style={{ fontSize: 14, color: '#64748b', maxWidth: 380, marginBottom: 28, lineHeight: 1.6 }}>
                The page you're looking for doesn't exist or may have moved.
            </p>
            <Link
                href="/"
                style={{
                    padding: '12px 28px', borderRadius: 10, border: 'none',
                    background: '#03a9e7', color: 'white', fontSize: 14, fontWeight: 600,
                    textDecoration: 'none',
                }}
            >
                Go home
            </Link>
        </div>
    )
}
