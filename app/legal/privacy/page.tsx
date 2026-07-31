import Link from 'next/link'
import type { Metadata } from 'next'
import { insurancePrivacy } from '@/lib/legal/insuranceLegalContent'
import { propertyPrivacy } from '@/lib/legal/propertyLegalContent'

// Public, unauthenticated page — required so Google's OAuth consent screen
// (and its verification review) has a real link to point to. Do not move this
// under /property or /insurance: middleware.ts gates those path prefixes
// behind login, which would make the link unreachable to Google's reviewer.
export const metadata: Metadata = {
    title: 'Privacy Policy | The Loan Connection',
}

export default function PrivacyPolicyPage() {
    return (
        <div style={{ minHeight: '100dvh', background: '#f8fafc' }}>
            <header style={{ background: '#052d4a', padding: '20px 16px' }}>
                <div style={{ maxWidth: 760, margin: '0 auto' }}>
                    <Link href="/" style={{ color: 'white', fontWeight: 800, fontSize: 18, textDecoration: 'none' }}>
                        The Loan <span style={{ color: '#03a9e7' }}>Connection</span>
                    </Link>
                </div>
            </header>

            <main style={{ maxWidth: 760, margin: '0 auto', padding: '40px 16px 80px' }}>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: '#052d4a', marginBottom: 8 }}>Privacy Policy</h1>
                <p style={{ color: '#64748b', fontSize: 14, marginBottom: 32 }}>
                    The Loan Connection (&ldquo;TLC&rdquo;) operates two agent-facing platforms covered by this
                    policy: the Insurance Agent Platform and the Property Agent Platform. Each has its own policy
                    below — refer to the one for the platform you use.
                </p>

                <section style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '28px 28px 32px', marginBottom: 24 }}>
                    {insurancePrivacy}
                </section>

                <section style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '28px 28px 32px' }}>
                    {propertyPrivacy}
                </section>
            </main>
        </div>
    )
}
