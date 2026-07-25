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
export const FEE_TYPES = [
    { key: 'hdb_refi', label: 'HDB Refinancing' },
    { key: 'pte_refi', label: 'PTE Refinancing' },
    { key: 'pte_refi_ntl', label: 'PTE Refinancing + New Term Loan' },
    { key: 'pte_buc_refi', label: 'PTE BUC Refinancing' },
    { key: 'hdb_resale', label: 'HDB Resale Purchase' },
    { key: 'hdb_bto', label: 'HDB BTO Purchase' },
    { key: 'condo_resale', label: 'Condo Resale Purchase' },
    { key: 'landed_resale', label: 'Landed Resale Purchase' },
    { key: 'pte_buc', label: 'PTE BUC Purchase' },
    { key: 'ec_buc', label: 'EC BUC Purchase' },
    { key: 'term_existing', label: 'Term Loan on Existing Mortgage' },
    { key: 'term_fully_paid', label: 'Term Loan on Fully Paid Property' },
    { key: 'hdb_sale', label: 'HDB Sale' },
    { key: 'pte_sale', label: 'PTE Sale' },
    { key: 'hdb_redemption', label: 'HDB Loan Redemption' },
    { key: 'pte_redemption', label: 'PTE Loan Redemption' },
    { key: 'bridging', label: 'Bridging Loan' },
    { key: 'decoupling', label: 'Decoupling (Both Parties)' },
    { key: 'hdb_divorce', label: 'HDB Divorce (Both Parties)' },
    { key: 'pte_divorce', label: 'PTE Divorce (Both Parties)' },
    { key: 'fresh_cpf', label: 'Fresh CPF Application' },
] as const
export type FeeKey = typeof FEE_TYPES[number]['key']

// The price list only holds for deals at or below this size; above it the desk
// quotes case by case.
export const PRICE_NOTE = 'Prices apply to purchase price / loan amount ≤ $2.5m. Above $2.5m, check with the law firm.'

export interface LawFirm {
    name: string
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

export const LAW_FIRMS: LawFirm[] = [
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
        name: 'Atkins Law Corporation',
        note: 'Only for UOB',
        contact: 'Ben',
        mobile: '88006608',
        location: 'Bugis',
        panel: { DBS: T, OCBC: F, UOB: T, SCB: F, HSBC: F, Maybank: T, CIMB: F, RHB: F, HLF: T, BOC: F, Citibank: F },
        fees: {
            hdb_refi: '$1,500', pte_refi: '$1,800', pte_refi_ntl: '$2,100', pte_buc_refi: '$1,800',
            hdb_resale: 'N/A', hdb_bto: 'N/A', condo_resale: 'N/A', landed_resale: 'N/A',
            pte_buc: 'N/A', ec_buc: 'N/A',
            term_existing: '$1,300', term_fully_paid: '$2,000',
            hdb_sale: '$1,300', pte_sale: '$2,000', hdb_redemption: '$700', pte_redemption: '$900',
            bridging: 'N/A', decoupling: 'N/A', hdb_divorce: 'N/A', pte_divorce: 'N/A', fresh_cpf: 'N/A',
        },
    },
    {
        name: 'Attorneys Inc LLC',
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
        contact: 'Sheila',
        mobile: '93266278',
        location: 'Toa Payoh',
        panel: { DBS: T, OCBC: T, UOB: T, SCB: T, HSBC: T, Maybank: T, CIMB: T, RHB: F, HLF: T, BOC: T, Citibank: T },
        fees: {
            hdb_refi: '$1,500', pte_refi: '$1,800', pte_refi_ntl: '$2,000', pte_buc_refi: '$1,800',
            hdb_resale: '$2,080', hdb_bto: '$2,500', condo_resale: '$2,700', landed_resale: '$3,300',
            pte_buc: '$3,000', ec_buc: 'N/A',
            term_existing: '$1,500', term_fully_paid: '$2,000',
            hdb_sale: '$1,620', pte_sale: '$2,484', hdb_redemption: '$648', pte_redemption: '$864',
            bridging: '$550', decoupling: '$8,300', hdb_divorce: '$6,200', pte_divorce: '$8,300', fresh_cpf: '$2,000',
        },
    },
    {
        name: 'Pertinent Law LLP',
        note: 'Only for private resale purchase cases when facing pricing competition',
        contact: 'Gregory',
        mobile: '84445505',
        location: 'Tanjong Pagar',
        panel: { DBS: T, OCBC: T, UOB: T, SCB: F, HSBC: F, Maybank: T, CIMB: F, RHB: T, HLF: T, BOC: F, Citibank: T },
        fees: {
            hdb_refi: '$1,500', pte_refi: '$1,800', pte_refi_ntl: '$2,288', pte_buc_refi: '$1,800',
            hdb_resale: '$1,888', hdb_bto: '$2,288', condo_resale: '$2,688', landed_resale: '$3,088',
            pte_buc: '$3,488', ec_buc: '$3,488',
            term_existing: '$1,488', term_fully_paid: '$1,988',
            hdb_sale: '$1,588', pte_sale: 'starting from $2,188',
            hdb_redemption: '$688\n($888 if using CPF)', pte_redemption: '$688\n($888 if using CPF)',
            bridging: '$500', decoupling: '$7,288',
            hdb_divorce: 'starting from $4,500', pte_divorce: 'starting from $5,500', fresh_cpf: '$1,888',
        },
    },
]

// Cells that were hard to read off the source screenshots and should be
// confirmed against the live sheet. Surfaced in the UI as a small notice.
// All purchase-column cells have now been verified against zoomed screenshots;
// the right-half columns (Term Loan onwards) still come from the original wide
// screenshot and are worth a glance before quoting.
export const LEGAL_VERIFY: string[] = []
