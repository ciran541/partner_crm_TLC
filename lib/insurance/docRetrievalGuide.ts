/**
 * Step-by-step guide for clients to retrieve the HDB / CPF / IRAS documents a
 * mortgage application needs. Sourced from The Loan Connection's own public guide
 * (theloanconnection.com.sg/our-step-by-step-guide-to-retrieve-hdb-cpf-and-iras-documents),
 * with the screenshots downloaded into public/guides/doc-retrieval/.
 *
 * Pure data — the Resources "Document Guide" tab renders it. Each document is an
 * ordered list of steps; each step carries the screenshot that illustrates it, so
 * the UI reads "do this → here's the screen" like real documentation. All three
 * portals require a SingPass login.
 */

export interface GuideStep {
    text: string
    /** Screenshot filename under /guides/doc-retrieval/ illustrating this step. */
    image?: string
}

export interface GuideDocument {
    id: string
    title: string
    /** What this document is / when it's needed — one line under the title. */
    note?: string
    steps: GuideStep[]
}

export interface GuideInstitution {
    key: 'hdb' | 'cpf' | 'iras'
    label: string
    /** Portal the client logs into (shown as a launch link). */
    portalUrl: string
    portalLabel: string
    /** Who typically needs these — helps the agent decide what to ask the client for. */
    blurb: string
    documents: GuideDocument[]
}

export const DOC_RETRIEVAL_GUIDE: GuideInstitution[] = [
    {
        key: 'hdb',
        label: 'HDB',
        portalUrl: 'https://www.hdb.gov.sg',
        portalLabel: 'My HDBPage',
        blurb: 'For HDB flats — financial info, the loan statement (HDB loan only), and flat details.',
        documents: [
            {
                id: 'hdb-financial-info',
                title: 'HDB Financial Information',
                note: 'Outstanding loan, monthly instalment and CPF used on the flat.',
                steps: [
                    { text: 'Go to hdb.gov.sg and select "Login to My HDBPage", then log in with SingPass.', image: '1.png' },
                    { text: 'In the menu on the left, click "My Flat" → "Purchased Flat".', image: '2.png' },
                    { text: 'Select "View Housing Loan and Financial Information".', image: 'purchased-flat.jpg' },
                    { text: 'Click "Save As PDF".', image: 'bp2.jpg' },
                ],
            },
            {
                id: 'hdb-soa',
                title: 'HDB Housing Loan Statement of Account (SOA)',
                note: 'Only for flats on an HDB (not bank) loan.',
                steps: [
                    { text: 'Go to hdb.gov.sg and log in to My HDBPage with SingPass.', image: '1.png' },
                    { text: 'In the menu on the left, click "My Flat" → "Purchased Flat".', image: '2.png' },
                    { text: 'Select "View Housing Loan and Financial Information".', image: 'soa1.jpg' },
                    { text: 'Click "View Statements of Account for Housing Loan".', image: 'soa2.jpg' },
                    { text: 'Set the period to the past 12 months and click "Continue".', image: 'soa3.jpg' },
                    { text: 'Save the page as PDF (use the "Save As PDF" button, or Ctrl + P).', image: 'save-whole-page.png' },
                ],
            },
            {
                id: 'hdb-flat-details',
                title: 'HDB Flat Details',
                note: 'Confirms flat type, lease and ownership.',
                steps: [
                    { text: 'Go to hdb.gov.sg and log in to My HDBPage with SingPass.', image: '1.png' },
                    { text: 'In the menu on the left, click "My Flat" → "Purchased Flat".', image: '2.png' },
                    { text: 'Select "Check Flat Details".', image: 'hdbf1.jpg' },
                    { text: 'Scroll to the bottom and click "Save As PDF".', image: 'hdbf2.jpg' },
                ],
            },
        ],
    },
    {
        key: 'cpf',
        label: 'CPF',
        portalUrl: 'https://www.cpf.gov.sg',
        portalLabel: 'my cpf',
        blurb: 'Contribution history, home-ownership dashboard, accrued interest and account balance.',
        documents: [
            {
                id: 'cpf-contribution-history',
                title: 'CPF Contribution History',
                note: 'Used to verify income for self-employed / commission earners.',
                steps: [
                    { text: 'Go to cpf.gov.sg and click "Login" with SingPass.', image: 'cpf-singpass-login.png' },
                    { text: 'Select "my cpf" → "Transaction history".', image: 'cpf1.jpg' },
                    { text: 'Click "Filter" (no date change needed).', image: 'cpf2.jpg' },
                    { text: 'Select both Transaction Types and click "Apply".', image: 'cpf3.jpg' },
                    { text: 'Click the PDF icon (top right) to save.', image: 'cpf4.jpg' },
                ],
            },
            {
                id: 'cpf-home-ownership',
                title: 'CPF Home Ownership Dashboard',
                note: 'Shows CPF used and accrued interest for the property.',
                steps: [
                    { text: 'Go to cpf.gov.sg and log in with SingPass.', image: 'cpf-singpass-login.png' },
                    { text: 'Click "my cpf" → "Home ownership".', image: 'cpf-home-ownership.png' },
                    { text: 'Check the correct property is selected, then press Ctrl + P to save all 6 pages.', image: 'save-pdf-six-pages.png' },
                ],
            },
            {
                id: 'cpf-property-withdrawal',
                title: 'CPF Property Withdrawal (Accrued Interest)',
                note: 'The principal amount + accrued interest to refund on sale.',
                steps: [
                    { text: 'Go to cpf.gov.sg and log in with SingPass.', image: 'cpf-singpass-login.png' },
                    { text: 'Select "my cpf" → "Home ownership".', image: 'cpf-home-ownership.png' },
                    { text: 'Confirm the property, then click "Principal amount and accrued interest".', image: 'cpf-save-pdf.png' },
                    { text: 'Click the PDF icon to save.', image: 'principal-amount-accrued-interest.png' },
                ],
            },
            {
                id: 'cpf-account-balance',
                title: 'CPF Account Balance',
                note: 'Current OA / SA / MA balances.',
                steps: [
                    { text: 'Go to cpf.gov.sg and log in with SingPass.', image: 'cpf-singpass-login.png' },
                    { text: 'Click the PDF icon (top right) to save the dashboard.', image: 'cpf-save-pdf-icon.png' },
                ],
            },
        ],
    },
    {
        key: 'iras',
        label: 'IRAS',
        portalUrl: 'https://mytax.iras.gov.sg',
        portalLabel: 'myTax Portal',
        blurb: 'Notice of Assessment (income proof), statement of account and property summary.',
        documents: [
            {
                id: 'iras-noa',
                title: 'IRAS Notice of Assessment (NOA)',
                note: 'Primary income proof for self-employed borrowers (latest 2 years).',
                steps: [
                    { text: 'Go to mytax.iras.gov.sg, choose "Personal Tax" and log in with SingPass.', image: 'iras1.jpg' },
                    { text: 'Click "Inbox" → "Individual".', image: 'iras2.jpg' },
                    { text: 'Open the latest "Notice of Assessment (Individual)" and save it as PDF.', image: 'iras3.jpg' },
                ],
            },
            {
                id: 'iras-soa',
                title: 'IRAS Statement of Account',
                note: 'Property tax account status.',
                steps: [
                    { text: 'Go to mytax.iras.gov.sg, choose "Personal Tax" and log in.', image: 'irasa1.jpg' },
                    { text: 'Click "Account" → "View Account Summary".', image: 'irasa2.jpg' },
                    { text: 'Under the Property Tax section, click "VIEW DETAILS".', image: 'irasa3.jpg' },
                    { text: 'Click "DOWNLOAD STATEMENT OF ACCOUNT" and save it as PDF.', image: 'irasa4.jpg' },
                ],
            },
            {
                id: 'iras-property-summary',
                title: 'IRAS Property Summary',
                note: 'List of properties owned (for ABSD / count of properties).',
                steps: [
                    { text: 'Go to mytax.iras.gov.sg, choose "Personal Tax" and log in.', image: 'irasp1.jpg' },
                    { text: 'Click "Property" → "View Property Summary".', image: 'irasp2.jpg' },
                    { text: 'Click "SAVE AS PDF / PRINT".', image: 'new.jpg' },
                ],
            },
        ],
    },
]
