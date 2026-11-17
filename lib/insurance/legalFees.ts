// Conveyancing / law-firm reference data for the Insurance CRM "Legal" page.
//
// Source: the desk's "Law Firm" cheat-sheet (three tables — a ban list, a bank
// panel grid, and a conveyancing price list). Transcribed from screenshots, so
// a handful of cells were ambiguous at build time — those are marked with a
// trailing "(?)" in the data and listed in LEGAL_VERIFY below for the desk to
// confirm. Everything here is reference data, editable in place; no logic
// derives from it beyond rendering.
//
// The panel and price tables share the same five firms in the same order, so a
// single LAW_FIRMS array carries both. The ban list is separate.

// ── Banned firms (do NOT use) ──────────────────────────────────────────────
export const BANNED_FIRMS = [
    'APAC Law Corporation',
    'Matthew Chiong Partnership',
    'Teh Lim & Partners',
    'Engelin Teh Practice LLC',
    'JHT Law Corporation',
] as const

// ── Bank panel columns ─────────────────────────────────────────────────────
export const PANEL_BANKS = [
    'DBS', 'OCBC', 'UOB', 'SCB', 'HSBC', 'Maybank', 'CIMB', 'RHB', 'HLF', 'BOC', 'Citibank',
] as const
export type PanelBank = typeof PANEL_BANKS[number]

// Header caveat carried straight from the sheet.
export const PANEL_NOTE = 'DBS has a special panel for divorce cases with a court order — check with the banker.'

// ── Price-list columns (conveyancing fee types) ────────────────────────────
export const FEE_GROUPS = ['Refinancing', 'Purchase', 'Term Loan', 'Sale & Redemption', 'Others'] as const
export type FeeGroup = typeof FEE_GROUPS[number]

export const FEE_TYPES = [
    { key: 'hdb_refi', label: 'HDB Refinancing', group: 'Refinancing' },
    { key: 'pte_refi', label: 'PTE Refinancing', group: 'Refinancing' },
    { key: 'pte_refi_ntl', label: 'PTE Refinancing + New Term Loan', group: 'Refinancing' },
    { key: 'pte_buc_refi', label: 'PTE BUC Refinancing', group: 'Refinancing' },
    { key: 'hdb_resale', label: 'HDB Resale Purchase', group: 'Purchase' },
    { key: 'hdb_bto', label: 'HDB BTO Purchase', group: 'Purchase' },
    { key: 'condo_resale', label: 'Condo Resale Purchase', group: 'Purchase' },
    { key: 'landed_resale', label: 'Landed Resale Purchase', group: 'Purchase' },
    { key: 'pte_buc', label: 'PTE BUC Purchase', group: 'Purchase' },
    { key: 'ec_buc', label: 'EC BUC Purchase', group: 'Purchase' },
    { key: 'term_existing', label: 'Term Loan on Existing Mortgage', group: 'Term Loan' },
    { key: 'term_fully_paid', label: 'Term Loan on Fully Paid Property', group: 'Term Loan' },
    { key: 'hdb_sale', label: 'HDB Sale', group: 'Sale & Redemption' },
    { key: 'pte_sale', label: 'PTE Sale', group: 'Sale & Redemption' },
    { key: 'hdb_redemption', label: 'HDB Loan Redemption', group: 'Sale & Redemption' },
    { key: 'pte_redemption', label: 'PTE Loan Redemption', group: 'Sale & Redemption' },
    { key: 'bridging', label: 'Bridging Loan', group: 'Others' },
    { key: 'decoupling', label: 'Decoupling (Both Parties)', group: 'Others' },
    { key: 'hdb_divorce', label: 'HDB Divorce (Both Parties)', group: 'Others' },
    { key: 'pte_divorce', label: 'PTE Divorce (Both Parties)', group: 'Others' },
    { key: 'fresh_cpf', label: 'Fresh CPF Application', group: 'Others' },
] as const satisfies readonly { key: string; label: string; group: FeeGroup }[]
export type FeeKey = typeof FEE_TYPES[number]['key']

// The price list only holds for deals at or below this size; above it the desk
// quotes case by case.
export const PRICE_NOTE = 'Prices apply to purchase price / loan amount ≤ $2.5m. Above $2.5m, check with the law firm.'

export interface LawFirm {
    name: string
    /** true = kept in the data but not shown on the Legal page (temporarily paused). */
    hidden?: boolean
    /** Usage guidance shown under the firm name (e.g. "Main law firm for BUC cases"). */
    note?: string
    contact: string
    mobile: string
    location: string
    /** true = on that bank's panel. */
    panel: Record<PanelBank, boolean>
    /** Fee display strings. 'N/A' where the firm doesn't offer it. */
    fees: Record<FeeKey, string>
}

const T = true, F = false

const ALL_LAW_FIRMS: LawFirm[] = [
    {
        name: 'Apex Law LLC',
        note: 'Main law firm for completed cases',
        contact: 'Ben',
        mobile: '88006608',
        location: 'Toa Payoh',
        panel: { DBS: T, OCBC: T, UOB: F, SCB: F, HSBC: T, Maybank: T, CIMB: T, RHB: T, HLF: T, BOC: F, Citibank: T },
        fees: {
            hdb_refi: '$1,500', pte_refi: '$1,800', pte_refi_ntl: '$2,100', pte_buc_refi: '$1,800',
            hdb_resale: '$1,800', hdb_bto: '$2,000', condo_resale: '$2,500', landed_resale: '$2,700',
            pte_buc: 'N/A', ec_buc: 'N/A',
            term_existing: '$1,300', term_fully_paid: '$2,000',
            hdb_sale: '$1,300', pte_sale: '$2,000', hdb_redemption: '$700', pte_redemption: '$900',
            bridging: '$300', decoupling: '$5,500', hdb_divorce: '$5,500', pte_divorce: '$5,500', fresh_cpf: '$1,620',
        },
    },
    {
        name: 'Attorneys Inc LLC',
        hidden: true, // paused for now — delete this line to show it again
        note: 'Main law firm for BUC cases',
        contact: 'Susan',
        mobile: '91063878',
        location: 'Suntec',
        panel: { DBS: T, OCBC: T, UOB: T, SCB: F, HSBC: T, Maybank: T, CIMB: T, RHB: F, HLF: T, BOC: F, Citibank: T },
        fees: {
            hdb_refi: '$1,500',
            pte_refi: '$1,700\n($1,800 if from SCB, RHB or BOC)',
            pte_refi_ntl: '$2,000', pte_buc_refi: '$2,000',
            hdb_resale: '$1,800 (below 1m)\n$2,000 (above 1m)',
            hdb_bto: '$2,200',
            condo_resale: '$2,450', landed_resale: '$2,750',
            pte_buc: '$2,350\n(TOP not issued)', ec_buc: '$2,700',
            term_existing: '$1,200 (Below 1M)', term_fully_paid: '$1,800 (Below 1M)',
            hdb_sale: '$1,300\n($1,450 if negative sale)', pte_sale: '$2,000',
            hdb_redemption: '$600 (using cash only)', pte_redemption: '$600 (using cash only)',
            bridging: '$500', decoupling: '$5,000', hdb_divorce: '$5,000', pte_divorce: '$5,000', fresh_cpf: 'N/A',
        },
    },
    {
        name: 'PKWA Law Practice LLC',
        note: 'Only for SCB, CIMB and BOC',
        contact: 'Gina',
        mobile: '93273185',
        location: 'Toa Payoh',
        panel: { DBS: T, OCBC: T, UOB: T, SCB: T, HSBC: T, Maybank: T, CIMB: T, RHB: F, HLF: T, BOC: T, Citibank: T },
        // Updated from PKWA's price sheet (updated as at 11/06/2026). BTO, BUC
        // purchase/refi, decoupling and divorce aren't on that sheet — kept as before.
        fees: {
            hdb_refi: '$1,500',
            pte_refi: '$1,700 (Condo)\n$1,800 (Landed)',
            pte_refi_ntl: '$1,900 (Condo)\n$2,000 (Landed)',
            pte_buc_refi: '$1,800',
            hdb_resale: '$2,080', hdb_bto: '$2,500',
            condo_resale: '$2,725\n(below 2.5m)', landed_resale: '$3,300\n(below 3m)',
            pte_buc: '$3,000', ec_buc: 'N/A',
            term_existing: '$1,500\n(below 1.5m)', term_fully_paid: '$2,000\n(below 1.5m)',
            hdb_sale: '$1,800',
            pte_sale: '$2,200\n($2,000 if no loan / no CPF refund)',
            hdb_redemption: '$654', pte_redemption: '$872',
            bridging: '$565', decoupling: '$8,300', hdb_divorce: '$6,200', pte_divorce: '$8,300', fresh_cpf: '$2,000',
        },
    },
    {
        name: 'Pertinent Law LLP',
        note: 'Only for private resale purchase cases when facing pricing competition',
        contact: 'Gregory',
        mobile: '84445505',
        location: 'Tanjong Pagar',
        panel: { DBS: T, OCBC: T, UOB: T, SCB: F, HSBC: F, Maybank: T, CIMB: F, RHB: T, HLF: T, BOC: F, Citibank: T },
        // Updated from Pertinent's "Legal fees effective September 2026" sheet
        // (their rates apply below $3m purchase price / valuation, incl. stamp
        // fee on mortgage & GST). Bridging isn't on that sheet — kept as before.
        fees: {
            hdb_refi: '$1,500', pte_refi: '$1,800', pte_refi_ntl: '$2,200', pte_buc_refi: '$1,800',
            hdb_resale: '$1,888', hdb_bto: '$2,888', condo_resale: '$2,500', landed_resale: '$3,000',
            pte_buc: 'starting from $3,500', ec_buc: 'starting from $3,500',
            term_existing: '$1,400', term_fully_paid: '$1,900\n(fresh mortgage required)',
            hdb_sale: '$1,588', pte_sale: 'starting from $2,100',
            hdb_redemption: '$700\n($900 if using CPF)', pte_redemption: '$700\n($900 if using CPF)',
            bridging: '$500', decoupling: '$7,000 (Private)\n$5,588 (HDB)',
            hdb_divorce: 'starting from $4,500', pte_divorce: 'starting from $5,500', fresh_cpf: '$1,800',
        },
    },
]

/** The firms shown on the Legal page — everything not marked `hidden`. */
export const LAW_FIRMS: LawFirm[] = ALL_LAW_FIRMS.filter(f => !f.hidden)

// Cells that were hard to read off the source screenshots and should be
// confirmed against the live sheet. Surfaced in the UI as a small notice.
// All purchase-column cells have now been verified against zoomed screenshots;
// the right-half columns (Term Loan onwards) still come from the original wide
// screenshot and are worth a glance before quoting.
export const LEGAL_VERIFY: string[] = []
