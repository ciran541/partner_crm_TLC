/**
 * Decoupling client document — buyer & seller perspectives, TDSR, stamp duties,
 * equity-loan headroom. Composes the shared presentation engine (presentationShell.ts)
 * so the on-screen modal, print, and emailed PDF are all the same HTML.
 */

import type { DecoupleComputation, DecoupleScenario } from '@/lib/insurance/decoupleCalc'
import type { DecoupleWorkflow } from '@/lib/types/workflow'
import {
    renderPresentation, section, notesBlock, money as fmtMoney, esc, type CoverStat,
} from '@/lib/insurance/presentationShell'

export interface DecouplePresentationData {
    clientName?: string
    advisorName?: string
    propertyLabel: string
    propertyValuation: number
    buyerShare: number          // percentage (e.g. 50)
    computation: DecoupleComputation
    workflow: DecoupleWorkflow
    autoPrint?: boolean
}

const money = (n: number) => fmtMoney(Math.abs(n))
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const table = (rows: string[]) => `<table class="kv">${rows.join('')}</table>`

const SCENARIO_LABELS: Record<DecoupleScenario, string> = {
    S1: 'Refinancing (Buyer takes over existing loan)',
    S2: 'New Purchase Loan (Property is fully paid)',
    S3: 'Refinancing + New Purchase Loan',
    S4: 'Cash / CPF only (No new loan needed)',
}

export function buildDecouplePresentationHtml(d: DecouplePresentationData): string {
    const c = d.computation
    const w = d.workflow
    const sellerShare = 100 - d.buyerShare

    const scenarioLabel = c.scenario ? SCENARIO_LABELS[c.scenario] : 'Scenario not yet determined'
    const isRefi = c.scenario === 'S1' || c.scenario === 'S3'
    const isPurchase = c.scenario === 'S2' || c.scenario === 'S3'
    const noLoan = c.scenario === 'S4'
    const sections: string[] = []

    // ── Buyer perspective ──
    const buyerRows: string[] = [
        `<tr><td>Purchase price (${sellerShare}% share)</td><td>${money(c.purchasePrice)}</td></tr>`,
        `<tr><td>Buyer's Stamp Duty (BSD)</td><td>${money(c.bsd)}</td></tr>`,
    ]
    if (c.absd > 0) buyerRows.push(`<tr><td>Additional BSD (ABSD · ${c.absdRatePct}%)</td><td>${money(c.absd)}</td></tr>`)
    buyerRows.push(`<tr><td>Legal fee (est.)</td><td>${money(c.buyerLegalFee)}</td></tr>`)

    if (isPurchase) {
        buyerRows.push(
            `<tr class="section-sep"><td colspan="2">Financing (${sellerShare}% share)</td></tr>`,
            `<tr><td>Minimum cash (5%)</td><td>${money(c.cash5)}</td></tr>`,
            `<tr><td>Balance CPF / cash (20%)</td><td>${money(c.cpfCash20)}</td></tr>`,
            `<tr><td>Bank loan (75%)</td><td>${money(c.bankLoan75)}</td></tr>`,
        )
        if (c.monthlyInstallment > 0) buyerRows.push(`<tr class="highlight"><td>Est. monthly instalment</td><td>${money(c.monthlyInstallment)}</td></tr>`)
    } else if (noLoan) {
        buyerRows.push(
            `<tr class="section-sep"><td colspan="2">No new financing required</td></tr>`,
            `<tr><td>CPF OA used for purchase</td><td>${money(c.cpfUsedForPurchase)}</td></tr>`,
            `<tr><td>Cash required</td><td>${money(c.cashRequired)}</td></tr>`,
        )
    } else if (isRefi) {
        buyerRows.push(
            `<tr class="section-sep"><td colspan="2">Refinancing (${d.buyerShare}% share of existing loan)</td></tr>`,
            `<tr><td>Loan portion to refinance</td><td>${money(c.buyerLoanLiability)}</td></tr>`,
        )
        if (c.refiMonthlyInstallment > 0) buyerRows.push(`<tr class="highlight"><td>Est. monthly instalment</td><td>${money(c.refiMonthlyInstallment)}</td></tr>`)
    }
    buyerRows.push(
        `<tr class="section-sep"><td colspan="2">Ownership structure (post-decoupling)</td></tr>`,
        `<tr><td>Property valuation</td><td>${money(d.propertyValuation)}</td></tr>`,
        `<tr><td>Loan portion</td><td>${money(c.loanForStructure)} (${pct(c.loanPct)})</td></tr>`,
        `<tr><td>CPF used</td><td>${money(c.totalCpfUsed)} (${pct(c.cpfPct)})</td></tr>`,
        `<tr class="highlight"><td>Cash equity</td><td>${pct(c.cashPct)}</td></tr>`,
    )
    sections.push(section('Buyer perspective', c.scenario ? scenarioLabel : undefined, table(buyerRows)))

    // ── Seller perspective ──
    const sellerRows: string[] = [
        `<tr><td>Sale price (${sellerShare}% share)</td><td>${money(c.sellingPrice)}</td></tr>`,
        `<tr><td>Seller's loan liability (${sellerShare}%)</td><td>−${money(c.sellerLoanLiability)}</td></tr>`,
        `<tr><td>CPF used by seller (to refund)</td><td>−${money(w.seller_cpf_usage ?? 0)}</td></tr>`,
        `<tr><td>Legal fee (est.)</td><td>−${money(c.sellerLegalFee)}</td></tr>`,
    ]
    if (c.ssd > 0) sellerRows.push(`<tr><td>Seller's Stamp Duty (SSD · ${c.ssdRatePct}%)</td><td>−${money(c.ssd)}</td></tr>`)
    sellerRows.push(`<tr class="highlight"><td>Estimated net cash proceeds</td><td>${c.cashProceeds >= 0 ? '' : '−'}${money(c.cashProceeds)}</td></tr>`)
    const cancelNote = c.cancellationFee > 0
        ? `<div class="alert">Estimated cancellation fee on the undisbursed amount ≈ ${money(c.cancellationFee)}.</div>`
        : ''
    sections.push(section('Seller perspective', undefined, table(sellerRows) + cancelNote))

    // ── TDSR (not for S4) ──
    if (c.scenario !== 'S4' && c.grossMonthlyIncome > 0) {
        const tdsrRows: string[] = [
            `<tr><td>Gross monthly income</td><td>${money(c.grossMonthlyIncome)}</td></tr>`,
            `<tr><td>Existing monthly commitments</td><td>${money(c.existingMonthlyDebts)}</td></tr>`,
            `<tr><td>Available TDSR headroom (55%)</td><td>${money(c.availableTdsr)}</td></tr>`,
        ]
        if (isRefi) tdsrRows.push(
            `<tr class="section-sep"><td>Home loan stress instalment (4%)</td><td>${money(c.homeLoanStressInstallment)}</td></tr>`,
            `<tr><td>Refi TDSR ${c.refiTdsrPass ? '✓ Pass' : '✗ Fail'}</td><td>${money(c.refiStressInstallment)} required</td></tr>`,
        )
        if (isPurchase) {
            const capacity = c.scenario === 'S3' ? c.balanceTdsrForPurchase : c.availableTdsr
            tdsrRows.push(
                `<tr class="section-sep"><td>Purchase loan stress instalment (4%)</td><td>${money(c.purchaseStressInstallment)}</td></tr>`,
                `<tr><td>Available for purchase${c.scenario === 'S3' ? ' (after refi)' : ''}</td><td>${money(capacity)}</td></tr>`,
                `<tr><td>Purchase TDSR ${c.purchaseTdsrPass ? '✓ Pass' : '✗ Fail'}</td><td></td></tr>`,
            )
        }
        for (const { label, pledge } of [
            { label: 'Refi pledge', pledge: c.refiPledge },
            { label: 'Purchase pledge', pledge: c.purchasePledge },
        ]) {
            if (pledge) tdsrRows.push(`<tr><td>${label}: pledge</td><td>${money(pledge.pledgeFund)} (locked 4 yrs) or show ${money(pledge.showFund)}</td></tr>`)
        }
        sections.push(section('TDSR eligibility', undefined, table(tdsrRows)))
    }

    // ── Equity loan headroom ──
    if (d.propertyValuation > 0) {
        const eq: string[] = [
            `<tr><td>Property valuation</td><td>${money(d.propertyValuation)}</td></tr>`,
            `<tr><td>75% LTV ceiling</td><td>${money(d.propertyValuation * 0.75)}</td></tr>`,
            `<tr><td>Loan portion (${pct(c.loanPct)})</td><td>${money(c.loanForStructure)}</td></tr>`,
            `<tr><td>CPF used (${pct(c.cpfPct)})</td><td>${money(c.totalCpfUsed)}</td></tr>`,
        ]
        if (c.equityEligible) {
            eq.push(`<tr class="highlight"><td>Equity loan headroom (LTV)</td><td>${money(c.equityLoanMaxLtv)}</td></tr>`)
            if (w.equity_loan_amount && w.equity_loan_amount > 0) {
                eq.push(
                    `<tr><td>Requested equity loan</td><td>${money(w.equity_loan_amount)}</td></tr>`,
                    `<tr><td>Equity TDSR ${c.equityTdsrPass ? '✓ Pass' : '✗ Fail'}</td><td></td></tr>`,
                )
                if (c.equityPledge) eq.push(`<tr><td>To pass: pledge</td><td>${money(c.equityPledge.pledgeFund)} or show ${money(c.equityPledge.showFund)}</td></tr>`)
            }
        } else {
            eq.push(`<tr><td>Equity loan eligibility</td><td>Not eligible${c.equityNotEligibleReason ? ` — ${esc(c.equityNotEligibleReason)}` : ''}</td></tr>`)
        }
        sections.push(section('Equity loan headroom', undefined, table(eq)))
    }

    // ── Key things to note ──
    const notes = [
        'Stamp duties shown are estimates based on prevailing IRAS rates — verify exact amounts with your solicitor before committing.',
        "Cancellation fee (if applicable) is approximately 0.75% of the undisbursed loan amount and depends on the bank's Letter of Offer.",
        'Monthly instalments are estimated at the reference rate entered — actual rates are subject to bank assessment.',
        'All figures are for discussion only and are not a formal offer of credit.',
    ]
    if (c.ssd > 0) notes.unshift(`Seller's Stamp Duty (SSD) of ${money(c.ssd)} applies — the seller has held the property for less than 4 years.`)
    sections.push(section('Key things to note', undefined, notesBlock([], notes)))

    const coverStats: CoverStat[] = [
        { label: 'Property', value: d.propertyLabel },
        { label: 'Valuation', value: money(d.propertyValuation) },
        { label: 'Buyer acquires', value: `${sellerShare}% share` },
        ...(c.weightedAge ? [{ label: 'Weighted age', value: `${c.weightedAge} yrs` }] : []),
    ]

    return renderPresentation({
        planLabel: 'Decoupling Plan',
        docTitle: `Decoupling Plan${d.clientName ? ` — ${d.clientName}` : ''}`,
        heading: d.clientName ? `Prepared for ${d.clientName}` : 'Your decoupling summary',
        advisorName: d.advisorName,
        coverStats,
        bodyHtml: sections.join('\n'),
        disclaimer: 'All figures are estimates for discussion only and are subject to the bank’s formal assessment and approval. Stamp duties follow prevailing IRAS rates — verify with your solicitor before committing.',
        autoPrint: d.autoPrint,
    })
}
