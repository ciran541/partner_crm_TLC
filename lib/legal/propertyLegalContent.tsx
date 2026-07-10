// Shared by the property signup page and the re-consent renewal page —
// keeping this in one place means both always show the exact same text.
// NOTE: this is placeholder copy, not legally reviewed. Bump
// CURRENT_TERMS_VERSION/CURRENT_PRIVACY_VERSION in consentVersions.ts when
// this content changes so existing users are prompted to re-accept.

export const propertyTerms = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Property Agent Platform – Terms & Conditions</h2>
        <p className="text-xs text-slate-500">Last Updated: May 22, 2026</p>
        <p className="text-slate-600">
            Welcome to TLC Property Agent Platform (&ldquo;Platform&rdquo;), operated by The Loan Connection (TLC).
        </p>
        <p className="text-slate-600">
            By creating an account or using this platform, you agree to these Terms & Conditions.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Eligibility</h3>
        <p className="text-slate-600">You must:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Be at least 18 years old</li>
            <li>Provide accurate registration details</li>
            <li>Use the platform only for legitimate business-related mortgage/refinance submissions</li>
            <li>Be authorized to submit information related to your clients or cases</li>
        </ul>
        <p className="text-slate-600">TLC may suspend or terminate accounts that violate these terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. Platform Purpose</h3>
        <p className="text-slate-600">This platform allows approved property agents to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Submit refinance-related cases</li>
            <li>Upload supporting documents</li>
            <li>Track commission-related activity</li>
            <li>View recurring earning opportunities</li>
            <li>Track lock-in follow-up information</li>
        </ul>
        <p className="text-slate-600">TLC may modify platform features at any time.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Account Responsibility</h3>
        <p className="text-slate-600">You are responsible for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Maintaining login confidentiality</li>
            <li>Protecting your password</li>
            <li>All activity under your account</li>
            <li>Promptly notifying TLC of unauthorized access</li>
        </ul>
        <p className="text-slate-600">Do not share accounts.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Case Submission Accuracy</h3>
        <p className="text-slate-600">You agree that all submitted:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>client information</li>
            <li>refinance details</li>
            <li>uploaded documents</li>
            <li>LO (Letter of Offer)</li>
            <li>commission-related data</li>
        </ul>
        <p className="text-slate-600">must be accurate and lawful.</p>
        <p className="text-slate-600">False, misleading, or unauthorized submissions may result in suspension.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Document Uploads</h3>
        <p className="text-slate-600">You may upload:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>PDF files</li>
            <li>JPEG/PNG images</li>
            <li>supporting mortgage/refinance documents</li>
        </ul>
        <p className="text-slate-600">You must not upload:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>malicious files</li>
            <li>illegal content</li>
            <li>unrelated personal data</li>
            <li>copyrighted material without permission</li>
        </ul>
        <p className="text-slate-600">TLC may remove content.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Commission & Earnings</h3>
        <p className="text-slate-600">
            Displayed earnings, commissions, or recurring opportunities are for operational tracking.
        </p>
        <p className="text-slate-600">Final payout or confirmation may depend on:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>bank verification</li>
            <li>refinance completion</li>
            <li>internal review</li>
            <li>approval conditions</li>
        </ul>
        <p className="text-slate-600">Displayed values may be updated.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Platform Availability</h3>
        <p className="text-slate-600">TLC does not guarantee uninterrupted availability.</p>
        <p className="text-slate-600">Maintenance, updates, outages, or technical issues may occur.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">8. Acceptable Use</h3>
        <p className="text-slate-600">You must not:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>misuse the platform</li>
            <li>attempt unauthorized access</li>
            <li>interfere with system integrity</li>
            <li>scrape data</li>
            <li>upload malware</li>
            <li>impersonate another user</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">9. Account Suspension</h3>
        <p className="text-slate-600">TLC may suspend, restrict, or terminate accounts for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>fraud</li>
            <li>abuse</li>
            <li>security risk</li>
            <li>policy violation</li>
            <li>misuse</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">10. Limitation of Liability</h3>
        <p className="text-slate-600">TLC is not liable for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>indirect losses</li>
            <li>data interruption</li>
            <li>third-party banking delays</li>
            <li>missed commission opportunities caused by external parties</li>
            <li>service outages</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">11. Changes to Terms</h3>
        <p className="text-slate-600">TLC may update these Terms at any time.</p>
        <p className="text-slate-600">Continued use of the platform means acceptance of revised terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">12. Contact</h3>
        <p className="text-slate-600">Questions:</p>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)

export const propertyPrivacy = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Property Agent Platform – Privacy Policy</h2>
        <p className="text-xs text-slate-500">Last Updated: May 22, 2026</p>
        <p className="text-slate-600">The Loan Connection (&ldquo;TLC&rdquo;) respects your privacy.</p>
        <p className="text-slate-600">This Privacy Policy explains how we collect, use, and protect information.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Information We Collect</h3>

        <p className="font-semibold text-slate-700 mt-2">Account Information</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Full name</li>
            <li>Email address</li>
            <li>Login credentials</li>
            <li>Agent profile information</li>
        </ul>

        <p className="font-semibold text-slate-700 mt-2">Case Information</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Refinance case details</li>
            <li>Loan-related information</li>
            <li>Commission-related tracking</li>
        </ul>

        <p className="font-semibold text-slate-700 mt-2">Uploaded Documents</p>
        <p className="text-slate-600">May include:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Letter of Offer</li>
            <li>PDF/JPEG supporting documents</li>
        </ul>

        <p className="font-semibold text-slate-700 mt-2">Technical Information</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>device/browser information</li>
            <li>IP address</li>
            <li>timestamps</li>
            <li>usage activity</li>
            <li>login events</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. How We Use Data</h3>
        <p className="text-slate-600">We use data to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>create/manage accounts</li>
            <li>process refinance-related workflows</li>
            <li>verify submitted cases</li>
            <li>track commissions</li>
            <li>manage recurring follow-up opportunities</li>
            <li>improve platform security</li>
            <li>audit platform activity</li>
            <li>send operational notifications</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Legal/Business Basis</h3>
        <p className="text-slate-600">We process information to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>provide services</li>
            <li>maintain operational records</li>
            <li>protect platform security</li>
            <li>comply with business/legal obligations</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Data Sharing</h3>
        <p className="text-slate-600">
            TLC may share limited data with internal staff and authorized platform administrators. We also use
            technical service providers to operate the platform: Resend (transactional email) and Google Sheets
            (internal reporting). We do not sell personal data.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Document Handling</h3>
        <p className="text-slate-600">Uploaded documents may be stored for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>verification</li>
            <li>audit</li>
            <li>operational tracking</li>
            <li>compliance</li>
        </ul>
        <p className="text-slate-600">Access is restricted.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Security</h3>
        <p className="text-slate-600">We take reasonable steps to protect:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>user accounts</li>
            <li>uploaded files</li>
            <li>stored records</li>
            <li>access permissions</li>
        </ul>
        <p className="text-slate-600">However, no system is 100% secure.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Retention</h3>
        <p className="text-slate-600">We may retain records for:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>business operations</li>
            <li>audits</li>
            <li>commission tracking</li>
            <li>legal/compliance requirements</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">8. Your Rights</h3>
        <p className="text-slate-600">Where applicable, users may request:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>account updates</li>
            <li>corrections</li>
            <li>access requests</li>
            <li>deletion requests (subject to operational/legal constraints)</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">9. Cookies / Technical Tracking</h3>
        <p className="text-slate-600">The platform may use:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>authentication cookies</li>
            <li>session handling</li>
            <li>basic analytics</li>
            <li>security logs</li>
        </ul>

        <h3 className="font-bold text-lg text-slate-800 pt-2">10. Changes to Privacy Policy</h3>
        <p className="text-slate-600">TLC may update this Privacy Policy.</p>
        <p className="text-slate-600">Continued platform use indicates acceptance.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">11. Contact</h3>
        <p className="text-slate-600">For privacy questions:</p>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)
