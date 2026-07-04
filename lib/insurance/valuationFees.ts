// Bank valuation fee reference data for the Insurance CRM "Valuation Fees" page.
//
// Source: a bank-fee cheat sheet spreadsheet. Many cells were blank in the
// original because the fee was set in a merged cell spanning multiple property
// value bands (i.e. "no new tier disclosed here, same fee as the tier above").
// This file stores the RAW sparse data (`undefined` = blank in the source) and
// `lookupValuationFees()` below carries the last known value forward per bank,
// per section — do not hand-fill blanks when editing this data.

export type ValFeePropertyType = 'HDB' | 'Private'

export interface ValFeeTransactionOption {
    key: string
    label: string
}

export const VAL_FEE_PROPERTY_TYPES: { key: ValFeePropertyType; label: string }[] = [
    { key: 'HDB', label: 'HDB' },
    { key: 'Private', label: 'Private (Including EC)' },
]

export const VAL_FEE_TRANSACTIONS: Record<ValFeePropertyType, ValFeeTransactionOption[]> = {
    HDB: [
        { key: 'resale', label: 'Resale' },
        { key: 'bto', label: 'BTO / SOBF' },
        { key: 'refinancing', label: 'Refinancing' },
    ],
    Private: [
        { key: 'buc', label: 'BUC (Building Under Construction)' },
        { key: 'resale_refi', label: 'Resale / Refinancing' },
    ],
}

export const VAL_FEE_BANKS = ['DBS', 'OCBC', 'UOB', 'SCB', 'Maybank', 'Citibank', 'HSBC', 'CIMB', 'HLF', 'BOC'] as const
export type ValFeeBank = typeof VAL_FEE_BANKS[number]

interface FeeBand {
    label: string
    min: number
    max: number | null   // null = no upper bound
}

interface FeeSection {
    bands: FeeBand[]
    // sparse — one entry per band, undefined means "not disclosed at this tier"
    cells: Record<ValFeeBank, (string | undefined)[]>
}

const ALL_BAND: FeeBand[] = [{ label: 'All', min: 0, max: null }]

const SECTIONS: Record<ValFeePropertyType, Record<string, FeeSection>> = {
    HDB: {
        resale: {
            bands: ALL_BAND,
            cells: {
                DBS: ['Not Required'], OCBC: ['Not Required'], UOB: ['Not Required'], SCB: ['Not Required'],
                Maybank: ['Not Required'], Citibank: ['Not Required'], HSBC: ['Not Required'],
                CIMB: ['N/A'], HLF: ['Not Required'], BOC: ['N/A'],
            },
        },
        bto: {
            bands: ALL_BAND,
            cells: {
                DBS: ['Not Required'], OCBC: ['Not Required'], UOB: ['Not Required'], SCB: ['Not Required'],
                Maybank: ['Not Required'], Citibank: ['Not Required'], HSBC: ['Not Required'],
                CIMB: [undefined], HLF: ['Not Required'], BOC: [undefined],
            },
        },
        refinancing: {
            bands: ALL_BAND,
            cells: {
                DBS: ['$200+GST'], OCBC: ['$270 nett'], UOB: ['$150+GST'], SCB: ['$150+GST'],
                Maybank: ['$200–214'], Citibank: ['Ask banker (Citibank valuation fee is based on size)'],
                HSBC: ['$180~200 nett'], CIMB: [undefined],
                HLF: ['Internal valuation, no charges'], BOC: [undefined],
            },
        },
    },
    Private: {
        buc: {
            bands: [
                { label: '≤ $2,000,000', min: 0, max: 2_000_000 },
                { label: '$2,000,001 – $3,000,000', min: 2_000_001, max: 3_000_000 },
                { label: '$3,000,001 – $4,000,000', min: 3_000_001, max: 4_000_000 },
                { label: '> $4,000,000', min: 4_000_001, max: null },
            ],
            cells: {
                DBS: ['$80+GST', undefined, undefined, undefined],
                OCBC: ['$115 nett', undefined, undefined, undefined],
                UOB: ['$80+GST', undefined, undefined, undefined],
                SCB: ['$50+GST', undefined, '$70+GST', undefined],
                Maybank: ['Not Required', undefined, undefined, undefined],
                Citibank: ['Ask banker (Citibank valuation fee is based on size)', undefined, undefined, undefined],
                HSBC: ['$100 – $250 nett depending on size', undefined, undefined, undefined],
                CIMB: ['N/A', undefined, undefined, undefined],
                HLF: ['N/A', undefined, undefined, undefined],
                BOC: ['$200 nett', '$300 nett', '$300 nett', '$400 nett'],
            },
        },
        resale_refi: {
            bands: [
                { label: '≤ $500,000', min: 0, max: 500_000 },
                { label: '$500,001 – $1,000,000', min: 500_001, max: 1_000_000 },
                { label: '$1,000,001 – $1,500,000', min: 1_000_001, max: 1_500_000 },
                { label: '$1,500,001 – $2,000,000', min: 1_500_001, max: 2_000_000 },
                { label: '$2,000,001 – $2,500,000', min: 2_000_001, max: 2_500_000 },
                { label: '$2,500,001 – $3,000,000', min: 2_500_001, max: 3_000_000 },
                { label: '$3,000,001 – $3,500,000', min: 3_000_001, max: 3_500_000 },
                { label: '$3,500,001 – $4,000,000', min: 3_500_001, max: 4_000_000 },
                { label: '$4,000,001 – $4,500,000', min: 4_000_001, max: 4_500_000 },
                { label: '$4,500,001 – $5,000,000', min: 4_500_001, max: 5_000_000 },
                { label: '$5,000,001 – $6,000,000', min: 5_000_001, max: 6_000_000 },
                { label: '$6,000,001 – $7,000,000', min: 6_000_001, max: 7_000_000 },
                { label: '$7,000,001 – $8,000,000', min: 7_000_001, max: 8_000_000 },
                { label: '> $8,000,000', min: 8_000_001, max: null },
            ],
            cells: {
                DBS: [
                    '$325+GST', undefined,
                    '$400+GST', '$450+GST',
                    '$550+GST', undefined,
                    '$625+GST', undefined,
                    '$700+GST', undefined,
                    '$700 + 0.02% in excess of $5m, +GST', undefined, undefined, undefined,
                ],
                OCBC: [
                    '$335 nett (Condo)\n$370 nett (Landed)', undefined,
                    '$415 nett (Condo)\n$470 nett (Landed)\n$350 nett (Stella)', undefined,
                    '$470 nett (Condo)\n$570 nett (Landed)', undefined,
                    '$495 nett (Condo)\n$695 nett (Landed)', undefined,
                    '$540 nett (Condo)\n$770 nett (Landed)', undefined,
                    '$540 + 0.02% in excess of $5m nett (Condo)\n$770 + 0.02% in excess of $5m nett (Landed)', undefined, undefined, undefined,
                ],
                UOB: [
                    '$150+GST', '$220+GST',
                    undefined, undefined,
                    '$150+GST (Condo)\n$500+GST (Landed)', '$450+GST',
                    '$400+GST (Condo)\n$625+GST (Landed)', '$550+GST',
                    '$450+GST (Condo)\n$725+GST (Landed)', '$700+GST',
                    '$475+0.02% in excess of $5m, +GST (Condo)\n$750+0.02% in excess of $5m, +GST (Landed)', undefined, undefined, undefined,
                ],
                SCB: [
                    '$170+GST', undefined,
                    '$300+GST', '$350+GST',
                    '$400+GST', undefined,
                    '$500+GST', undefined,
                    '$650+GST', undefined,
                    '$700+0.02% in excess of $5m, capped at $3,500, +GST', undefined, undefined, undefined,
                ],
                Maybank: [
                    '$300', undefined,
                    '$300~400', undefined,
                    '$400~500', undefined,
                    'Ask banker (Maybank valuation fee is not fixed, can negotiate if necessary)', undefined,
                    undefined, undefined,
                    undefined, undefined, undefined, undefined,
                ],
                Citibank: [
                    'Ask banker (Citibank valuation fee is based on size)', undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined, undefined, undefined,
                ],
                HSBC: [
                    'HSBC valuation fee is based on size and individual valuer:\n\n'
                    + 'Condo\n≤ 1,000sf: $340–375 nett\n1,001–1,500sf: $395–482 nett\n1,501–2,000sf: $513–535 nett\n> 2,000sf: $695.50 nett\n\n'
                    + 'Landed\nTerrace: $588.50 nett\nSemi-D: $800 nett\nDetached (≤ 10,000sf): $1,070 nett\nDetached (10,001–15,000sf): $1,605 nett\nDetached (> 15,000sf): $2,000 nett',
                    undefined, undefined, undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined, undefined, undefined,
                ],
                CIMB: [
                    'Up to $500 (CIMB banker cannot choose valuer, to be assigned by credit)', undefined,
                    undefined, undefined,
                    undefined, undefined,
                    'Depends on individual valuer (CIMB banker cannot choose valuer, to be assigned by credit)', undefined,
                    undefined, undefined,
                    undefined, undefined, undefined, undefined,
                ],
                HLF: [
                    'Internal valuation, no charges', undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined,
                    undefined, undefined, undefined, undefined,
                ],
                BOC: [
                    '$250 nett', undefined,
                    '$300 nett', '$350 nett',
                    '$450+GST', '$500+GST',
                    '$600+GST', undefined,
                    '$700+GST', undefined,
                    '$800+GST', '$900+GST', '$1,000+GST', '$1,000+0.03% in excess of $8m, +GST',
                ],
            },
        },
    },
}

export interface ValFeeEntry {
    bank: ValFeeBank
    text: string | null
    /** true if this value was carried forward from an earlier (lower) band, not stated at this exact tier */
    inherited: boolean
}

export interface ValFeeResult {
    band: FeeBand
    bandIndex: number
    bandCount: number
    entries: ValFeeEntry[]
}

export function lookupValuationFees(
    propertyType: ValFeePropertyType,
    transactionKey: string,
    value: number,
): ValFeeResult | null {
    const section = SECTIONS[propertyType]?.[transactionKey]
    if (!section) return null

    const found = section.bands.findIndex(b => value >= b.min && (b.max === null || value <= b.max))
    const idx = found === -1
        ? (value < section.bands[0].min ? 0 : section.bands.length - 1)
        : found
    const band = section.bands[idx]

    const entries: ValFeeEntry[] = VAL_FEE_BANKS.map(bank => {
        const col = section.cells[bank] ?? []
        let text: string | null = null
        let inherited = false
        for (let i = idx; i >= 0; i--) {
            if (col[i] !== undefined) {
                text = col[i] as string
                inherited = i !== idx
                break
            }
        }
        return { bank, text, inherited }
    })

    return { band, bandIndex: idx, bandCount: section.bands.length, entries }
}
