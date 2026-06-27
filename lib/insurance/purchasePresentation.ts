/**
 * New Purchase client document. Composes the shared presentation engine
 * (presentationShell.ts) so the on-screen modal, the printed page, and the emailed
 * PDF are all the same HTML — and stay in step with the workflow.
 */

import type { PurchaseComputation, OptionResult } from '@/lib/insurance/purchaseCalc'
import type { PurchaseRemarks } from '@/lib/insurance/purchaseRemarks'
import type { ProposalPackage } from '@/lib/insurance/purchaseProposal'
import type { SoraRates } from '@/lib/insurance/sora'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import { packageStyle } from '@/lib/insurance/rateFilters'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import {
    renderPresentation, section, packageCard, instalmentBreakdown, kvTable, notesBlock,
    money, esc, type CoverStat,
} from '@/lib/insurance/presentationShell'

export interface PresentationData {
    clientName?: string
    advisorName?: string
    propertyLabel: string
    price: number
    referenceRate?: number
    computation: PurchaseComputation
    remarks: PurchaseRemarks
    selectedPackage?: ProposalPackage | null
    sora?: SoraRates | null
    autoPrint?: boolean
}

const pct = (frac: number) => {
    const v = frac * 100
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`
}

function optionPanel(opt: OptionResult): string {
    const downTotal = opt.minCashDown + opt.cashCpfDown
    const pledge = opt.pledge
        ? `<div class="pledge">To reach the full ${pct(opt.ltvPct)}, pledge ${money(opt.pledge.pledgeFund)} (locked 4 yrs) or show ${money(opt.pledge.showFund)} in funds.</div>`
        : ''
    return `<div class="opt">
      <div class="opt-head"><div class="opt-title">Option ${esc(opt.key)}</div><div class="opt-sub">${pct(opt.ltvPct)} LTV · tenure to age ${opt.ageCap}</div></div>
      <div class="opt-loan">${money(opt.finalLoan)}<span>maximum bank loan</span></div>
      ${kvTable([
        { label: 'Loan tenure', value: `${opt.tenure} years` },
        { label: 'Est. monthly instalment', value: money(opt.installment) },
        { label: `Minimum cash (${pct(opt.minCashPct)})`, value: money(opt.minCashDown) },
        { label: `Balance cash / CPF (${pct(opt.cashCpfPct)})`, value: money(opt.cashCpfDown) },
        { label: 'Total downpayment', value: money(downTotal), total: true },
      ])}
      ${pledge}
    </div>`
}

export function buildPresentationHtml(d: PresentationData): string {
    const c = d.computation
    const sections: string[] = []

    // Financing options
    sections.push(section(
        'Your financing options',
        "Two ways the bank can structure the loan — we'll choose what fits your cash flow.",
        `<div class="opts">${c.options.map(optionPanel).join('')}</div>`,
    ))

    // Recommended package
    const pkg = d.selectedPackage
    if (pkg?.bank) {
        const scheduleLines = pkg.rate_schedule?.length
            ? formatRateSchedule(pkg.rate_schedule)
            : pkg.year1_rate != null ? [`Year 1: ${pkg.year1_rate.toFixed(2)}%`] : []
        const style = pkg.lockin_years != null && pkg.features
            ? packageStyle({ lockin_years: pkg.lockin_years, features: pkg.features })
            : null
        sections.push(section(
            'Recommended package',
            'The bank package best matched to this loan.',
            packageCard({
                bank: pkg.bank, package_name: pkg.package_name, category: pkg.category, lockin_years: pkg.lockin_years,
                scheduleLines, style, features: pkg.features,
                projected_monthly: pkg.projected_monthly,
            }),
        ))

        // Monthly instalment & interest breakdown (priced on Option A's loan + tenure)
        const opt = c.options[0]
        if (opt && pkg.rate_schedule?.length) {
            const rows = computeAmortization(opt.finalLoan, opt.tenure, pkg.rate_schedule, d.sora ?? null)
            const breakdown = instalmentBreakdown({ rows, lockinYears: pkg.lockin_years, monthly: pkg.projected_monthly, tenureYears: opt.tenure })
            if (breakdown) {
                sections.push(section(
                    'Monthly instalment & interest',
                    'Your estimated instalment and the interest paid during the lock-in (on Option A).',
                    breakdown,
                ))
            }
        }
    }

    // Upfront costs
    const feesTotal = c.bsd + c.absd + c.legalFee + c.valuationFee
    const absdLabel = `Additional Buyer's Stamp Duty (ABSD${c.absdRatePct ? ` · ${c.absdRatePct % 1 === 0 ? c.absdRatePct : c.absdRatePct.toFixed(1)}%` : ''})`
    sections.push(section(
        'Upfront costs',
        'One-time costs payable on purchase, separate from your downpayment.',
        kvTable([
            { label: "Buyer's Stamp Duty (BSD)", value: money(c.bsd) },
            { label: absdLabel, value: money(c.absd) },
            { label: 'Legal fee (est.)', value: money(c.legalFee) },
            { label: 'Valuation fee (est.)', value: money(c.valuationFee) },
            { label: 'Total stamp duty & fees', value: money(feesTotal), total: true },
        ]),
    ))

    // Key things to note
    const notes = [...d.remarks.standard, ...d.remarks.propertyType]
    if (d.remarks.alerts.length || notes.length) {
        sections.push(section('Key things to note', undefined, notesBlock(d.remarks.alerts, notes)))
    }

    const coverStats: CoverStat[] = [
        { label: 'Property', value: d.propertyLabel },
        { label: 'Purchase price', value: money(d.price) },
        ...(c.weightedAge ? [{ label: 'Avg. borrower age', value: String(c.weightedAge) }] : []),
    ]

    return renderPresentation({
        planLabel: 'Home Financing Plan',
        docTitle: `Home Financing Plan${d.clientName ? ` — ${d.clientName}` : ''}`,
        heading: d.clientName ? `Prepared for ${d.clientName}` : 'Your mortgage summary',
        advisorName: d.advisorName,
        coverStats,
        bodyHtml: sections.join('\n'),
        disclaimer: `All figures are estimates for discussion only and are subject to the bank’s formal assessment and approval. Stamp duties follow prevailing IRAS rates.${d.referenceRate ? ` Monthly instalments are estimated at ${d.referenceRate}% p.a.` : ''}`,
        autoPrint: d.autoPrint,
    })
}
