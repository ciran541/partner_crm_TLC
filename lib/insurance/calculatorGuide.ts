/**
 * What each Knowledge calculator does, for admins (Knowledge → Calculators).
 *
 * Every rate and limit here is read from the same constants the calculators
 * use, so this page can never disagree with what agents are told. Changing a
 * rate is a code change in stampDuty.ts / loanCalc.ts / purchaseCalc.ts /
 * refiCalc.ts (with tests), never an edit here. Safe in the browser.
 * Pinned by __tests__/calculatorGuide.test.ts: every example question really
 * reaches its calculator.
 */

import { BSD_TIERS, absdRate, type Residency } from '@/lib/insurance/stampDuty'
import { CANCELLATION_FEE_RATE, MIN_TENURE, MSR_LIMIT, NOA_FACTOR, STRESS_TEST_RATE, TDSR_LIMIT } from '@/lib/insurance/loanCalc'
import { OPTION_MATRIX, PURCHASE_PROPERTY_TYPES } from '@/lib/insurance/purchaseCalc'
import { MAX_AGE, REFI_PROPERTY_TYPES } from '@/lib/insurance/refiCalc'
import type { CalcKind, CalcValues } from '@/lib/insurance/knowledgeCalc'

export interface GuideTable { head: string[]; rows: string[][] }
export interface CalcGuide {
    kind: CalcKind
    /** One line: what it answers. */
    answers: string
    /** Questions agents type that reach it. */
    examples: string[]
    /** How it works, in order, in plain words. */
    steps: string[]
    tables: { title: string; table: GuideTable }[]
    /** Questions it deliberately does NOT answer (they go to articles instead). */
    notFor?: string
    /** The official page to check its rules against. */
    source: { name: string; url: string }
    /** Filled in for the example and as the start of "Try it". */
    sample: CalcValues
}

const pct = (n: number) => `${+(n * 100).toFixed(2)}%`

const IRAS_BSD = 'https://www.iras.gov.sg/taxes/stamp-duty/for-property/buying-or-acquiring-property/buyer%27s-stamp-duty-(bsd)'
const IRAS_ABSD = 'https://www.iras.gov.sg/taxes/stamp-duty/for-property/buying-or-acquiring-property/additional-buyer%27s-stamp-duty-(absd)'
const MAS_LTV = 'https://www.mas.gov.sg/regulation/explainers/new-housing-loans/loan-tenure-and-loan-to-value-limits'
const MAS_TDSR = 'https://www.mas.gov.sg/regulation/explainers/new-housing-loans/msr-and-tdsr-rules'

const LTV_TABLE: GuideTable = {
    head: ['Existing housing loans', 'Option 1 (ends by age 65)', 'Option 2 (ends by age 75)'],
    rows: (['0', '1', '2plus'] as const).map(k => {
        const [o1, o2] = OPTION_MATRIX[k]
        const cell = (o: typeof o1) => `Loan up to ${pct(o.ltvPct)} · at least ${pct(o.minCashPct)} cash`
        return [k === '0' ? 'None' : k === '1' ? '1' : '2 or more', cell(o1), cell(o2)]
    }),
}
const [OPT1, OPT2] = OPTION_MATRIX['0']
const TENURE_CAPS: GuideTable = {
    head: ['', 'Option 1', 'Option 2'],
    rows: [
        ['Age the loan must end by', `${OPT1.ageCap}`, `${OPT2.ageCap}`],
        ['Longest tenure: condo, landed, EC', `${OPT1.tenureCondoEC} years`, `${OPT2.tenureCondoEC} years`],
        ['Longest tenure: HDB flat, BTO', `${OPT1.tenureHdb} years`, `${OPT2.tenureHdb} years`],
    ],
}
const RESIDENCY: [Residency, string][] = [['singaporean', 'Singapore Citizen'], ['pr', 'Permanent Resident'], ['foreigner', 'Foreigner']]

export const CALC_GUIDES: CalcGuide[] = [
    {
        kind: 'bsd',
        answers: "Buyer's Stamp Duty on a residential purchase, with the amount per tier.",
        examples: ['BSD on 1.5m condo', 'How much BSD for a $900k flat'],
        steps: ['Split the price into the tiers below.', 'Multiply each slice by its rate and add them up.', 'Round the total down to the dollar.'],
        tables: [{ title: 'BSD tiers (residential)', table: { head: ['Part of the price', 'Rate'], rows: BSD_TIERS.map(t => [t.label, pct(t.rate)]) } }],
        notFor: 'Non-residential property, and the market value when it is higher than the price.',
        source: { name: 'IRAS: Buyer’s Stamp Duty', url: IRAS_BSD },
        sample: { price: 1_500_000 },
    },
    {
        kind: 'absd',
        answers: "Additional Buyer's Stamp Duty for one buyer, by residency and how many homes they will own.",
        examples: ['ABSD for PR buying 2nd home at 1.2m', 'ABSD foreigner 2m condo'],
        steps: ['Find the rate for the buyer and the home count in the table.', 'Multiply the price by that rate.', 'Round down to the dollar.'],
        tables: [{
            title: 'ABSD rates',
            table: { head: ['Buyer', '1st home', '2nd home', '3rd or later'], rows: RESIDENCY.map(([r, label]) => [label, ...([1, 2, 3] as const).map(c => pct(absdRate(r, c)))]) },
        }],
        notFor: 'Couples and joint buyers (remission), companies and trusts, and nationalities treated as Singapore Citizens under trade agreements (US, Switzerland, Norway, Iceland, Liechtenstein). These go to articles.',
        source: { name: 'IRAS: Additional Buyer’s Stamp Duty', url: IRAS_ABSD },
        sample: { price: 1_200_000, residency: 'pr', count: '2' },
    },
    {
        kind: 'instalment',
        answers: 'Monthly instalment for a loan amount, interest rate and tenure.',
        examples: ['Monthly instalment 800k at 1.6% 25 years', 'Monthly payment for 1.2m loan at 2.1% over 30 years'],
        steps: ['Standard loan formula: equal monthly payments over the tenure.', 'Monthly rate = yearly rate ÷ 12; number of payments = years × 12.', 'Instalment = loan × r × (1+r)ⁿ ÷ ((1+r)ⁿ − 1).'],
        tables: [],
        notFor: 'Packages whose rate changes over time (it assumes one rate for the whole tenure).',
        source: { name: 'Standard loan formula (no official page)', url: '' },
        sample: { loan: 800_000, rate: 1.6, years: 25 },
    },
    {
        kind: 'cancellation',
        answers: 'Cancellation fee when refinancing a loan that is not fully disbursed (BUC property).',
        examples: ['Cancellation fee on 300k undisbursed', 'How much cancellation fee for 450k undisbursed'],
        steps: [`Undisbursed amount × ${pct(CANCELLATION_FEE_RATE)}.`],
        tables: [{ title: 'Rate used', table: { head: ['Fee', 'Rate'], rows: [['Cancellation fee on the undisbursed amount', pct(CANCELLATION_FEE_RATE)]] } }],
        notFor: "Banks set this in the Letter of Offer. HUB uses the usual rate and tells agents to confirm it.",
        source: { name: 'The client’s Letter of Offer (set by each bank)', url: '' },
        sample: { undisbursed: 300_000 },
    },
    {
        kind: 'tenure_buy',
        answers: 'Longest loan tenure when buying, for both financing options.',
        examples: ['Longest tenure for BTO, age 45', 'Max loan tenure for resale condo, my client is 50'],
        steps: [
            'For each option: the property’s longest tenure, or the years left until the age limit, whichever is shorter.',
            `Below ${MIN_TENURE} years the option is not available.`,
            'Several borrowers: use the income-weighted average age.',
        ],
        tables: [{ title: 'Tenure limits', table: TENURE_CAPS }, { title: 'Loan limits by option', table: LTV_TABLE }],
        source: { name: 'MAS: Loan tenure and LTV limits', url: MAS_LTV },
        sample: { property: 'bto', age: 45 },
    },
    {
        kind: 'tenure_refi',
        answers: 'Longest tenure when refinancing, from the borrower’s age and the year the property was bought.',
        examples: ['Refinancing tenure for HDB bought 2015, age 50', 'Longest refi tenure landed age 48 bought in 2010'],
        steps: [
            `By age: the property’s longest tenure, or ${MAX_AGE} minus the age, whichever is shorter.`,
            'By year of purchase: the longest tenure minus the years since purchase, minus 1.',
            `The answer is the shorter of the two. Under ${MIN_TENURE} years, or a borrower aged 71 or over, can't refinance.`,
        ],
        tables: [{ title: 'Longest tenure by property', table: { head: ['Property', 'Longest tenure'], rows: [...new Map(REFI_PROPERTY_TYPES.map(p => [p.label, `${p.tenureCap} years`])).entries()] } }],
        source: { name: 'MAS: Loan tenure and LTV limits', url: MAS_LTV },
        sample: { refi_property: 'hdb', age: 50, year: 2015 },
    },
    {
        kind: 'max_loan',
        answers: 'Roughly how much a buyer can borrow, for both options: the lower of what income allows and the LTV limit.',
        examples: ['How much can my client borrow for a resale condo', 'Max loan amount for BTO'],
        steps: [
            `Income allows: monthly income × ${pct(TDSR_LIMIT)} (TDSR) minus other debts; HDB flats and new ECs also capped at ${pct(MSR_LIMIT)} (MSR).`,
            `That monthly amount is turned into a loan at the ${pct(STRESS_TEST_RATE)} test rate over the option’s tenure.`,
            'LTV allows: price × the option’s LTV limit below.',
            'The loan is the lower of the two. HUB says which one limits it.',
        ],
        tables: [
            { title: 'Loan limits by option', table: LTV_TABLE },
            { title: 'Limits used', table: { head: ['Rule', 'Value'], rows: [
                ['TDSR (all property)', pct(TDSR_LIMIT)],
                ['MSR (HDB flat, BTO, EC new launch)', pct(MSR_LIMIT)],
                ['Test interest rate', pct(STRESS_TEST_RATE)],
                ['Variable and rental income counted at', pct(NOA_FACTOR)],
                ['Property types', PURCHASE_PROPERTY_TYPES.map(p => p.label).join(', ')],
            ] } },
        ],
        notFor: 'Variable income, several borrowers with different incomes, and refinancing. Agents use the full workflow for those.',
        source: { name: 'MAS: MSR and TDSR rules', url: MAS_TDSR },
        sample: { property: 'resale_condo', price: 1_500_000, income: 12_000, debts: 500, age: 40, loans: '0' },
    },
]

/** Which calculators to re-check when an official page changes. */
export function calculatorsForPage(url: string, section = ''): CalcKind[] {
    const t = `${decodeURIComponent(url)} ${section}`.toLowerCase()
    const out: CalcKind[] = []
    if (/buyer'?s-stamp-duty-\(bsd\)|\bbsd\b/.test(t)) out.push('bsd')
    if (/additional-buyer|\babsd\b/.test(t)) out.push('absd')
    if (/loan-to-value|loan-tenure|\bltv\b|tenure/.test(t)) out.push('tenure_buy', 'tenure_refi', 'max_loan')
    if (/tdsr|msr/.test(t)) out.push('max_loan')
    return [...new Set(out)]
}

