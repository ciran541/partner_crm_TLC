'use client'

import Link from 'next/link'
import { ArrowRight, LayoutDashboard, Lock } from 'lucide-react'

export default function LandingPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#052d4a',
      color: 'white',
      padding: '2rem',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Abstract Background Shapes */}
      <div style={{
        position: 'absolute',
        top: '-20%',
        right: '-10%',
        width: '600px',
        height: '600px',
        background: 'radial-gradient(circle, rgba(3,169,231,0.2) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none'
      }} />

      <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', maxWidth: '800px' }}>
        <img
          src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
          alt="The Loan Connection Logo"
          style={{ width: 120, height: 120, borderRadius: '16px', marginBottom: '32px', boxShadow: '0 20px 40px rgba(0,0,0,0.3)' }}
        />

        <h1 style={{
          fontSize: '3.5rem',
          fontWeight: '800',
          marginBottom: '1.5rem',
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: 'white'
        }}>
          The Loan <span style={{ color: '#03a9e7' }}>Connection</span>
        </h1>

        <p style={{
          fontSize: '1.25rem',
          color: '#cbd5e1',
          marginBottom: '3rem',
          maxWidth: '600px',
          marginLeft: 'auto',
          marginRight: 'auto',
          lineHeight: 1.6
        }}>
          Manage your mortgage cases, track your pipeline, and close deals faster with our professional partner CRM.
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
          <Link
            href="/login"
            style={{
              textDecoration: 'none',
              background: '#03a9e7',
              color: 'white',
              padding: '16px 32px',
              borderRadius: '8px',
              fontWeight: '600',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'transform 0.2s',
              border: 'none'
            }}
          >
            <Lock size={18} />
            Partner Login
          </Link>

          <Link
            href="/dashboard"
            style={{
              textDecoration: 'none',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.3)',
              color: 'white',
              padding: '16px 32px',
              borderRadius: '8px',
              fontWeight: '600',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background 0.2s'
            }}
          >
            <LayoutDashboard size={18} />
            Go to Dashboard
          </Link>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: '2rem', color: '#64748b', fontSize: '13px' }}>
        &copy; {new Date().getFullYear()} The Loan Connection. All rights reserved.
      </div>
    </div>
  )
}
