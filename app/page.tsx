import Link from 'next/link'
import { ArrowRight, Lock, Briefcase } from 'lucide-react'

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
          style={{
            width: 120,
            height: 120,
            borderRadius: '16px',
            marginBottom: '32px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            display: 'block',
            margin: '0 auto 32px auto'
          }}
        />

        <p style={{
          fontSize: '0.85rem',
          fontWeight: '700',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: '#03a9e7',
          marginBottom: '0.75rem'
        }}>
          The Loan Connection CRM
        </p>

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
          fontSize: '0.95rem',
          color: '#cbd5e1',
          marginBottom: '3rem',
          maxWidth: '560px',
          marginLeft: 'auto',
          marginRight: 'auto',
          lineHeight: 1.6
        }}>
          The Loan Connection CRM is the partner platform for our mortgage insurance and property agents.
          Agents manage client cases end-to-end, track their pipeline and commissions, browse bank rate
          packages, and — for agents who choose to connect Google Calendar — keep case follow-up reminders
          synced automatically so nothing falls through the cracks.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center' }}>
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
            Insurance CRM Login
          </Link>

          <Link
            href="/property/login"
            style={{
              textDecoration: 'none',
              background: '#059669',
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
            <Briefcase size={18} />
            Property Portal Login
          </Link>

          <Link
            href="/property/signup"
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
            <ArrowRight size={18} />
            Property Agent Sign Up
          </Link>
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: '2rem', color: '#64748b', fontSize: '13px' }}>
        &copy; {new Date().getFullYear()} The Loan Connection. All rights reserved.
      </div>
    </div>
  )
}
