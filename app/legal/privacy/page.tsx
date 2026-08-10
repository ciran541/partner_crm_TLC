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

                <section style={{ background: '#eff6ff', borderRadius: 12, border: '1px solid #bfdbfe', padding: '24px 28px', marginBottom: 24 }}>
                    <h2 style={{ fontSize: 17, fontWeight: 800, color: '#052d4a', marginBottom: 10 }}>
                        Google API Limited Use Disclosure
                    </h2>
                    <p style={{ color: '#334155', fontSize: 14, lineHeight: 1.6 }}>
                        The Loan Connection CRM&rsquo;s use and transfer of information received from Google APIs
                        (including Google Calendar, accessed via the <code>calendar.events</code> scope) to any
                        other app will adhere to the{' '}
                        <a href="https://developers.google.com/workspace/workspace-api-user-data-developer-policy" style={{ color: '#03a9e7' }}>
                            Google API Services User Data Policy
                        </a>, including the Limited Use requirements. Calendar data is used solely to create,
                        update, and delete a single case follow-up reminder event on the connecting agent&rsquo;s
                        own calendar — it is never read for any other purpose, and it is never sent to, or
                        processed by, any third-party AI/ML service.
                    </p>
                    <p style={{ color: '#334155', fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>
                        Data segregation: the Platform separately uses AI/ML services (Google Gemini and DeepSeek)
                        for unrelated features — knowledge-article search, mortgage-document extraction, and
                        summarization of bank rate sheets, bank research reports, and public mortgage news. These
                        features are implemented in an entirely separate part of the codebase from the Google
                        Calendar integration, with no shared code path between them. The only inputs these AI/ML
                        services ever receive are: admin-authored knowledge base content, an agent&rsquo;s typed
                        search query, text extracted from a document the agent uploaded, admin-pasted bank rate or
                        promotion text, and content fetched from public bank and news websites. No data obtained
                        from any Google API — including Google Calendar — is ever sent to, or used by, Gemini,
                        DeepSeek, or any other AI/ML service, whether raw, aggregated, or derived, nor is it ever
                        used to train, develop, or improve any artificial intelligence or machine learning model,
                        foundational or otherwise.
                    </p>
                </section>

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
