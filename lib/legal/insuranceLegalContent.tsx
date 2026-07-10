// Shared by the insurance signup page and the re-consent renewal page —
// keeping this in one place means both always show the exact same text.
// NOTE: this is placeholder copy, not legally reviewed. Bump
// CURRENT_TERMS_VERSION/CURRENT_PRIVACY_VERSION in consentVersions.ts when
// this content changes so existing users are prompted to re-accept.

export const insuranceTerms = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Insurance Agent Platform – Terms & Conditions</h2>
        <p className="text-xs text-slate-500">Last Updated: July 7, 2026</p>
        <p className="text-slate-600">
            Welcome to TLC's Insurance Agent Platform (&ldquo;Platform&rdquo;), operated by The Loan Connection (TLC).
        </p>
        <p className="text-slate-600">
            By creating an account or using this platform, you agree to these Terms & Conditions.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Eligibility</h3>
        <p className="text-slate-600">You must:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Be at least 18 years old</li>
            <li>Provide accurate registration details</li>
            <li>Access this platform only via an invite issued to you by TLC</li>
            <li>Use the platform only for legitimate mortgage-advisory client work</li>
        </ul>
        <p className="text-slate-600">TLC may suspend or terminate accounts that violate these terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. Platform Purpose</h3>
        <p className="text-slate-600">This platform allows approved insurance agents to:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600">
            <li>Manage refinancing, purchase, decoupling, and equity-loan client cases</li>
            <li>Browse mortgage rate packages and rate recommendations</li>
            <li>Use the knowledge assistant and calculators</li>
            <li>Track commission-related activity</li>
        </ul>
        <p className="text-slate-600">TLC may modify platform features at any time.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Account Responsibility</h3>
        <p className="text-slate-600">You are responsible for maintaining login confidentiality, protecting your password, and all activity under your account. Do not share accounts.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Case Accuracy</h3>
        <p className="text-slate-600">All client information, case details, and commission-related data you submit must be accurate and lawful. False or unauthorized submissions may result in suspension.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Acceptable Use</h3>
        <p className="text-slate-600">You must not misuse the platform, attempt unauthorized access, scrape data, or impersonate another user.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Changes to Terms</h3>
        <p className="text-slate-600">TLC may update these Terms at any time. Continued use of the platform means acceptance of revised terms.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Contact</h3>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)

export const insurancePrivacy = (
    <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-800">TLC Insurance Agent Platform – Privacy Policy</h2>
        <p className="text-xs text-slate-500">Last Updated: July 7, 2026</p>
        <p className="text-slate-600">The Loan Connection (&ldquo;TLC&rdquo;) respects your privacy and explains here how we collect, use, and protect information.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">1. Information We Collect</h3>
        <p className="text-slate-600">Account information (name, email, login credentials, agent profile details), case information (mortgage case details, workflow answers, commission tracking), and technical information (device/browser, IP address, login events).</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">2. How We Use Data</h3>
        <p className="text-slate-600">To create/manage accounts, process client workflows, track commissions, improve platform security, and send operational notifications.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">3. Data Sharing</h3>
        <p className="text-slate-600">
            TLC may share limited data with internal staff and authorized administrators. We also use technical
            service providers to operate the platform: Resend (transactional email), Google Sheets (internal
            reporting), and AI providers (Google Gemini, DeepSeek) that help power the knowledge assistant, rate-sheet
            processing, and news/report summaries. We do not sell personal data.
        </p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">4. Security</h3>
        <p className="text-slate-600">We take reasonable steps to protect user accounts and stored records, though no system is 100% secure.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">5. Your Rights</h3>
        <p className="text-slate-600">Where applicable, you may request account updates, corrections, access, or deletion, subject to operational/legal constraints.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">6. Changes to Privacy Policy</h3>
        <p className="text-slate-600">TLC may update this Privacy Policy. Continued platform use indicates acceptance.</p>

        <h3 className="font-bold text-lg text-slate-800 pt-2">7. Contact</h3>
        <p className="font-semibold text-slate-800">The Loan Connection (TLC)</p>
    </div>
)
