// Shared by the property signup page and the re-consent renewal page —
// keeping this in one place means both always show the exact same text.
//
// Drafted against the actual data flows this codebase implements (see
// CLAUDE.md) and Singapore's Personal Data Protection Act 2012 (PDPA), not
// generic template language. Still needs a lawyer's review before being
// treated as final — in particular: confirm the UEN/registered address
// placeholders below, confirm the named DPO contact channel, and confirm
// the overseas-transfer and data-breach clauses match TLC's actual
// operational practice (e.g. any Standard Contractual Clauses/DPAs signed
// with Resend, Google, Supabase, Vercel).
//
// Bump CURRENT_TERMS_VERSION/CURRENT_PRIVACY_VERSION in consentVersions.ts
// when this content changes so existing users are prompted to re-accept.

export const propertyTerms = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Property Agent Platform – Terms & Conditions</h2>
        <p className="text-xs text-slate-500">Last Updated: 11 July 2026</p>

        <p className="text-slate-600">
            These Terms & Conditions (&ldquo;Terms&rdquo;) govern access to and use of the TLC Property Agent
            Platform (&ldquo;Platform&rdquo;), operated by The Loan Connection (&ldquo;TLC&rdquo;, &ldquo;we&rdquo;,
            &ldquo;us&rdquo;), a mortgage advisory business registered in Singapore (UEN: [Company UEN]), with
            registered address at [Registered Business Address]. By creating an account or otherwise using the
            Platform, you (&ldquo;you&rdquo;, the &ldquo;Agent&rdquo;) agree to be bound by these Terms.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Eligibility</h3>
        <p className="text-slate-600">To use the Platform, you must:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Be at least 18 years old and have full legal capacity to enter into these Terms</li>
            <li>Be a property agent engaged with or referred through TLC</li>
            <li>Provide accurate, current, and complete registration details</li>
            <li>Use the Platform only for legitimate business-related mortgage/refinance submissions on behalf of your own clients</li>
        </ul>
        <p className="text-slate-600">TLC may verify your eligibility at any time and may suspend or terminate accounts that fail to meet it.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. Platform Purpose</h3>
        <p className="text-slate-600">The Platform allows approved property agents to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Submit and manage refinance-related client cases</li>
            <li>Upload supporting documents, including Letters of Offer</li>
            <li>Track commission-related activity and recurring earning opportunities</li>
            <li>Track lock-in expiry and follow-up information for their clients</li>
        </ul>
        <p className="text-slate-600">TLC may add, modify, or remove Platform features at any time, with or without notice, provided this does not materially deprive you of the core functionality you rely on without reasonable notice.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Account Registration & Security</h3>
        <p className="text-slate-600">You are responsible for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Maintaining the confidentiality of your login credentials</li>
            <li>Choosing a strong password and not sharing your account with anyone else</li>
            <li>All activity that occurs under your account</li>
            <li>Promptly notifying TLC of any suspected unauthorized access</li>
        </ul>
        <p className="text-slate-600">TLC enforces a single active session per account and may terminate other active sessions when you log in from a new device.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Your Responsibility for Client Data</h3>
        <p className="text-slate-600">
            When you submit a client&rsquo;s name, contact details, loan or financial information, or supporting
            documents to the Platform, <strong>you are responsible for having a lawful basis to do so</strong> —
            including, where required, having informed your client and obtained their consent to your sharing their
            personal data with TLC for the purpose of arranging their refinancing. TLC processes this data on your
            behalf and on your instructions as described in the Platform&rsquo;s Privacy Policy; TLC is not a party
            to, and does not verify, the underlying consent arrangement between you and your client.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Case Submission Accuracy</h3>
        <p className="text-slate-600">You agree that all client information, refinance details, uploaded documents, Letters of Offer, and commission-related data you submit are accurate, complete, and lawfully obtained. False, misleading, or unauthorized submissions may result in case rejection, commission forfeiture, and/or account suspension.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Document Uploads</h3>
        <p className="text-slate-600">You may upload PDF, JPEG, or PNG files (up to 10MB each) as supporting mortgage/refinance documents. You must not upload malicious files, illegal content, personal data unrelated to the case at hand, or copyrighted material you do not have permission to share. TLC may remove any uploaded content at its discretion.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Commission & Earnings</h3>
        <p className="text-slate-600">
            Commission amounts, earnings, and recurring-opportunity figures displayed on the Platform are for
            operational tracking and are estimates only. Final payout is subject to bank verification, refinance
            completion, internal review, and any applicable agency agreement between you and TLC. Displayed values
            may be revised as a case progresses.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">8. Platform Availability</h3>
        <p className="text-slate-600">TLC does not guarantee uninterrupted or error-free availability of the Platform. Maintenance, updates, outages, or technical issues may occur from time to time.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">9. Acceptable Use</h3>
        <p className="text-slate-600">You must not: misuse the Platform; attempt unauthorized access to any account, data, or system; interfere with system integrity or security; scrape or bulk-extract data; upload malware; or impersonate another person.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">10. Intellectual Property</h3>
        <p className="text-slate-600">The Platform, including its software, design, calculators, and content (excluding data you submit), is owned by or licensed to TLC and protected by intellectual property laws. You are granted a limited, non-exclusive, non-transferable right to use the Platform for its intended business purpose only.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">11. Suspension & Termination</h3>
        <p className="text-slate-600">TLC may suspend, restrict, or terminate your account for fraud, abuse, security risk, policy violation, breach of these Terms, or if your engagement with TLC ends. You may stop using the Platform at any time; this does not affect obligations that arose before termination.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">12. Limitation of Liability</h3>
        <p className="text-slate-600">
            To the extent permitted by law, TLC is not liable for indirect or consequential losses, data
            interruption, third-party banking delays, missed commission opportunities caused by external parties, or
            service outages. Nothing in these Terms excludes liability that cannot be excluded under Singapore law.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">13. Indemnity</h3>
        <p className="text-slate-600">You agree to indemnify and hold TLC harmless against claims, losses, or damages arising from your breach of these Terms, your misuse of the Platform, or a dispute between you and your client relating to data you submitted.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">14. Governing Law & Disputes</h3>
        <p className="text-slate-600">These Terms are governed by the laws of Singapore. Any dispute arising from these Terms or your use of the Platform is subject to the exclusive jurisdiction of the courts of Singapore.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">15. Changes to These Terms</h3>
        <p className="text-slate-600">TLC may update these Terms from time to time. Material changes will require you to re-accept the updated Terms before continuing to use the Platform; continued use after a non-material update constitutes acceptance.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">16. Contact</h3>
        <p className="text-slate-600">Questions about these Terms:</p>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC) — [contact email]</p>
    </div>
)

export const propertyPrivacy = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Property Agent Platform – Privacy Policy</h2>
        <p className="text-xs text-slate-500">Last Updated: 7 August 2026</p>
        <p className="text-slate-600">
            The Loan Connection (&ldquo;TLC&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is committed to protecting
            personal data in accordance with Singapore&rsquo;s Personal Data Protection Act 2012 (&ldquo;PDPA&rdquo;).
            This Policy explains what personal data we collect through the Property Agent Platform, how we use it,
            who we share it with, and your rights.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Personal Data We Collect</h3>
        <p className="font-semibold text-slate-700 mt-2">About you (the Agent)</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Full name, email address, mobile number, login credentials</li>
            <li>Agent profile information (agency name, CEA registration number)</li>
            <li>Technical data: device/browser information, IP address, login timestamps, session activity</li>
        </ul>
        <p className="font-semibold text-slate-700 mt-2">About your clients, which you submit to the Platform</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Client name, mobile number, email address</li>
            <li>Property, loan, and refinance details; commission-related figures</li>
            <li>Uploaded documents, including Letters of Offer</li>
        </ul>
        <p className="text-slate-600">
            You are responsible for the lawful collection of your clients&rsquo; personal data before submitting it
            to the Platform — see &ldquo;Your Responsibility for Client Data&rdquo; in the Terms & Conditions.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. How We Use Your Data</h3>
        <p className="text-slate-600">We collect, use, and disclose personal data to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Create and manage your account, and verify your identity</li>
            <li>Process and track refinance-related cases and commissions</li>
            <li>Send operational notifications (case updates, follow-up reminders, commission status)</li>
            <li>Sync follow-up dates to your connected Google Calendar, if you choose to connect one</li>
            <li>Maintain internal records for audit, security, and compliance purposes</li>
            <li>Improve and secure the Platform</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Consent</h3>
        <p className="text-slate-600">
            By creating an account, you consent to the collection, use, and disclosure of your personal data as
            described in this Policy. You may withdraw consent at any time by contacting us (see &ldquo;Contact
            Us&rdquo; below); withdrawing consent for data necessary to operate your account may mean we can no
            longer provide the Platform to you, and will not affect the lawfulness of processing carried out before
            withdrawal.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Who We Share Data With</h3>
        <p className="text-slate-600">We do not sell personal data. We share data with the following categories of recipients, only as needed to operate the Platform:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li><strong>Internal staff and authorized TLC administrators</strong>, on a need-to-know basis</li>
            <li><strong>Supabase</strong> — our database, authentication, and file-storage infrastructure provider</li>
            <li><strong>Vercel</strong> — our application hosting provider</li>
            <li><strong>Resend</strong> — for sending transactional email (account, case, and follow-up notifications)</li>
            <li><strong>Google Sheets</strong> — for internal reporting</li>
            <li><strong>Google Calendar</strong> — for case follow-up reminders, only if you choose to connect your calendar (initiated and controlled by you). This data is never shared with any other recipient in this list, including the AI provider below</li>
            <li><strong>DeepSeek</strong> — an AI provider used to extract structured data from Letters of Offer you upload. Only the document text needed for extraction is sent — no other case or client data, and no data obtained from any Google API, including Google Calendar</li>
            <li><strong>Sentry</strong> — for error monitoring, to help us detect and fix technical issues</li>
            <li>Banking or operational partners, where required to verify or process a case</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Overseas Transfer of Data</h3>
        <p className="text-slate-600">
            Some of the service providers listed above may store or process data on servers located outside
            Singapore. Where we transfer personal data overseas, we take steps required under the PDPA to ensure the
            recipient provides a standard of protection comparable to the PDPA, including through contractual
            obligations with our service providers.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Data Retention</h3>
        <p className="text-slate-600">
            We retain personal data for as long as your account is active, and afterward only as necessary for
            business operations, audits, commission reconciliation, or to meet legal and regulatory record-keeping
            obligations. When data is no longer needed for these purposes, we take reasonable steps to delete or
            anonymize it.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Data Security</h3>
        <p className="text-slate-600">
            We apply reasonable technical and organizational measures to protect personal data against unauthorized
            access, collection, use, disclosure, or loss — including encrypted connections, role-based access
            controls, and rate-limiting on public-facing endpoints. No system is completely secure, and we cannot
            guarantee absolute security.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">8. Data Breach Notification</h3>
        <p className="text-slate-600">
            In the event of a data breach that is likely to result in significant harm, or that is of a significant
            scale, we will notify the Personal Data Protection Commission (PDPC) and affected individuals as
            required under the PDPA&rsquo;s mandatory data breach notification obligation.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">9. Your Rights (Access & Correction)</h3>
        <p className="text-slate-600">
            Subject to certain exceptions under the PDPA, you may request access to the personal data we hold about
            you, request correction of inaccurate data, or request deletion of your account. Some data may be
            retained despite a deletion request where we have a legal or legitimate business reason to do so (e.g.
            commission or audit records). To exercise these rights, contact us using the details below.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">10. Cookies & Session Data</h3>
        <p className="text-slate-600">The Platform uses strictly necessary cookies for authentication and session handling. We do not use third-party advertising or tracking cookies.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">11. Changes to This Policy</h3>
        <p className="text-slate-600">We may update this Policy from time to time. Material changes will require you to re-accept the updated Policy before continuing to use the Platform.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">12. Contact Us / Data Protection Officer</h3>
        <p className="text-slate-600">For privacy questions, access/correction requests, or to withdraw consent, contact our Data Protection Officer:</p>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC) — [DPO name/role] — [DPO contact email]</p>
    </div>
)
