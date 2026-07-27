/**
 * Pre-determined, dynamic advisory remarks for the New Purchase workflow.
 *
 * Purpose: based on the client's inputs, the CRM surfaces
 * the key talking points the agent should advise the client on. Copy is fixed,
 * but which bullets appear — and the figures inside them — adapt to the inputs
 * (property type, OTP status, whether they're selling an existing property,
 * intention to sell at TOP, and the computed BSD/ABSD).
 */

import type { PurchasePropertyType, Residency, OutstandingLoans } from '@/lib/insurance/purchaseCalc'
import { submissionChecklist } from '@/lib/insurance/bankSubmission'

export interface RemarkContext {
    propertyType?: PurchasePropertyType
    otpObtained?: boolean
    sellingExisting?: boolean
    sellAtTop?: boolean
    residency?: Residency        // worst-case across borrowers
    outstanding?: OutstandingLoans
    bsd?: number
    absd?: number
}

export interface PurchaseRemarks {
    alerts: string[]          // input-driven warnings (amber)
    standard: string[]        // always shown
    propertyType: string[]    // tailored to the selected property type
}

const money = (n?: number) => (n && n > 0 ? `$${Math.round(n).toLocaleString()}` : null)

// Always shown, regardless of property type.
const STANDARD_REMARKS: string[] = [
    'Interest rates can only be secured once the OTP from the seller/developer has been obtained. For Resale HDB, banks will also require the valuation report from HDB.',
    'Proper budgeting is only possible once you know how much loan the bank can grant (via an IPA), how much cash and CPF you have for the downpayment and miscellaneous fees, and what monthly instalment you are comfortable with.',
]

// BSD/ABSD-in-cash bullet with the actual computed figures injected (condo / landed).
function bsdAbsdCashLine(ctx: RemarkContext): string {
    const bsd = money(ctx.bsd)
    const absd = money(ctx.absd)
    const bsdPart = bsd ? `BSD (~${bsd})` : 'BSD'
    const absdPart = absd ? ` and ABSD (~${absd})` : ' and ABSD (if applicable)'
    return `Take note: ${bsdPart}${absdPart} must be paid in cash to IRAS, with optional reimbursement from CPF on completion. In practice CPF cannot disburse monies to IRAS within the 2-week BSD/ABSD deadline.`
}

function condoLandedRemarks(ctx: RemarkContext, isLanded: boolean): string[] {
    const out = [
        'Different banks value the property differently — we can obtain indicative valuations from banks, which are useful for your negotiations with the seller(s).',
        'The maximum LTV is based on the purchase price or valuation, whichever is lower.',
        "Buyer's Stamp Duty (BSD) is based on the purchase price or valuation, whichever is higher.",
        bsdAbsdCashLine(ctx),
    ]
    if (isLanded) {
        out.push('Double-check with the seller(s) whether the landed property has obtained its Certificate of Statutory Completion (CSC) or only Temporary Occupation Permit (TOP) — some ID contractors don\'t obtain CSC after works are done. Without CSC, most banks will not finance; DBS/SCB are open to it for now.')
    }
    return out
}

function resaleHdbRemarks(ctx: RemarkContext): string[] {
    const out = [
        'Valuation is determined by HDB. Upon placing the $1k Option Fee, you have 21 days to secure a loan and submit a valuation request to HDB at the same time.',
        'Assuming income is strong enough, banks can grant a mortgage loan of up to 75% of the purchase price or valuation, whichever is lower.',
    ]
    if (ctx.sellingExisting) {
        out.push('Since you are selling and buying a HDB, banks can still grant the maximum LTV (75%/55%) even if your current HDB is not yet sold — you will be required to dispose of your current HDB within 6 months.')
    }
    return out
}

function btoRemarks(): string[] {
    return [
        'The full loan is only disbursed upon key collection — no instalment is payable and no interest is charged by the bank until the loan is disbursed.',
        'The law firm takes approximately 2 months to disburse the loan, so the key collection date will be delayed if it falls within 2 months of loan acceptance.',
        'Only BTO floating rate packages are available if there is no notice to collect keys yet. If key collection is within 3 months, some banks (e.g. DBS) can appeal to secure fixed rates upfront.',
    ]
}

// Bullets 1–3 are common to both uncompleted (BUC) property types.
function bucCommonRemarks(): string[] {
    return [
        'Only floating rates are available for uncompleted properties — the earliest you can switch to a fixed rate is when the project reaches TOP (Temporary Occupation Permit) status.',
        'From now till TOP you must choose one of these floating rate packages: SORA-based, Fixed-Deposit-Linked, or Board Rates. SORA is the most transparent — no bank controls it, and it is updated daily on the MAS website.',
        'You will likely stay with your first bank until the project obtains its Certificate of Statutory Completion (CSC), usually about 1 year after TOP. Switching earlier means a 0.75%–1.50% cancellation fee on your undisbursed loan — the full loan is only disbursed at CSC, when the property is legally completed.',
    ]
}

function newLaunchRemarks(ctx: RemarkContext): string[] {
    return [
        ...bucCommonRemarks(),
        ctx.sellAtTop
            ? 'Since you may sell at TOP: go for a 1M/3M SORA package with the lowest spreads and ensure it includes a "Full Waiver of Cancellation Fee due to Sale" feature.'
            : 'Consider a 1M/3M SORA package with the lowest spreads. If there is any intention to sell at TOP, ensure the package includes a "Full Waiver of Cancellation Fee due to Sale" feature.',
    ]
}

function ecNewLaunchRemarks(): string[] {
    return [
        ...bucCommonRemarks(),
        'Consider a 1M/3M SORA package with the lowest spreads.',
        'If you opt for the Deferred Payment Scheme (DPS), the loan is only disbursed at TOP — no instalment or interest is payable to the bank until the loan is disbursed.',
        'If you own a HDB and require a bridging loan to bridge the 15% downpayment for DPS, OCBC/UOB are open to granting it.',
    ]
}

function propertyTypeRemarks(ctx: RemarkContext): string[] {
    switch (ctx.propertyType) {
        case 'resale_condo': return condoLandedRemarks(ctx, false)
        case 'resale_landed': return condoLandedRemarks(ctx, true)
        case 'resale_hdb': return resaleHdbRemarks(ctx)
        case 'bto': return btoRemarks()
        case 'new_launch_condo': return newLaunchRemarks(ctx)
        case 'ec_new_launch': return ecNewLaunchRemarks()
        default: return []
    }
}

/** The OTP-not-obtained notice — shown inline in the UI just above the rate packages. */
export const OTP_NOT_OBTAINED_REMARK = 'OTP not yet obtained — The earliest you can secure an interest rate package from a bank, is only when OTP has been issued by seller/developer.'

export function buildRemarks(ctx: RemarkContext): PurchaseRemarks {
    return {
        alerts: [],
        standard: STANDARD_REMARKS,
        propertyType: propertyTypeRemarks(ctx),
    }
}

// ─── Next actions (guidance checklist, tailored per property type) ─────────────

export function nextActions(
    type?: PurchasePropertyType,
    opts?: { selectedBank?: string },
): string[] {
    // Once a digital bank has been picked, the submission checklist replaces the
    // generic per-property advisory steps.
    const submission = submissionChecklist(opts?.selectedBank)
    if (submission) return submission

    switch (type) {
        case 'new_launch_condo':
        case 'ec_new_launch':
            return [
                'Confirm the OTP / book the unit with the developer',
                'Shortlist a floating (SORA) package before TOP',
                'Get an IPA to confirm loan eligibility',
                'Submit the loan application to the chosen bank',
                'Set aside BSD/ABSD to pay IRAS in cash',
            ]
        case 'resale_hdb':
            return [
                'Place the $1k Option Fee',
                'Within 21 days: secure the loan + submit the HDB valuation request',
                'Get an IPA and collect income documents',
                'Set aside BSD to pay IRAS in cash',
            ]
        case 'bto':
            return [
                'Wait for the HDB key-collection notice',
                'Secure a BTO floating package (or appeal for fixed if key collection is within 3 months)',
                'Get an IPA to confirm loan eligibility',
                'Plan loan disbursement ~2 months ahead of key collection',
            ]
        case 'resale_condo':
        case 'resale_landed':
            return [
                'Request indicative valuations from banks for negotiation',
                'Obtain the OTP from the seller',
                'Get an IPA and collect income documents',
                'Submit the loan application to the chosen bank',
                'Set aside BSD/ABSD to pay IRAS in cash',
            ]
        default:
            return [
                'Obtain the OTP from the seller/developer',
                'Get an IPA to confirm loan eligibility',
                'Collect income documents and submit the application',
            ]
    }
}
