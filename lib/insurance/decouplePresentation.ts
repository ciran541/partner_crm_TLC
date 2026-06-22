/**
 * Print / email PDF document for the Decoupling advisory.
 * Covers buyer perspective, seller perspective, TDSR, stamp duties, and equity loan.
 * Mirrors the style of refiPresentation.ts and purchasePresentation.ts.
 */

import type { DecoupleComputation, DecoupleScenario } from '@/lib/insurance/decoupleCalc'
import type { DecoupleWorkflow } from '@/lib/types/workflow'

export interface DecouplePresentationData {
    clientName?: string
    advisorName?: string
    propertyLabel: string
    propertyValuation: number
    buyerShare: number          // percentage (e.g. 50)
    computation: DecoupleComputation
    workflow: DecoupleWorkflow
}

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString()}`
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

const SCENARIO_LABELS: Record<DecoupleScenario, string> = {
    S1: 'Refinancing (Buyer takes over existing loan)',
    S2: 'New Purchase Loan (Property is fully paid)',
    S3: 'Refinancing + New Purchase Loan',
    S4: 'Cash / CPF only (No new loan needed)',
}

export function buildDecouplePresentationHtml(d: DecouplePresentationData): string {
    const c = d.computation
    const w = d.workflow
    const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
    const sellerShare = 100 - d.buyerShare

    const scenarioLabel = c.scenario ? SCENARIO_LABELS[c.scenario] : 'Scenario not yet determined'
    const isRefi = c.scenario === 'S1' || c.scenario === 'S3'
    const isPurchase = c.scenario === 'S2' || c.scenario === 'S3'
    const noLoan = c.scenario === 'S4'

    // ── Buyer section ─────────────────────────────────────────────────────────
    const buyerRows: string[] = [
        `<tr><td>Purchase price (${sellerShare}% share)</td><td>${money(c.purchasePrice)}</td></tr>`,
        `<tr><td>Buyer's Stamp Duty (BSD)</td><td>${money(c.bsd)}</td></tr>`,
    ]
    if (c.absd > 0) buyerRows.push(`<tr><td>Additional BSD (ABSD · ${c.absdRatePct}%)</td><td>${money(c.absd)}</td></tr>`)
    buyerRows.push(`<tr><td>Legal fee (est.)</td><td>${money(c.buyerLegalFee)}</td></tr>`)

    if (isPurchase) {
        buyerRows.push(
            `<tr class="section-sep"><td colspan="2"><strong>Financing (${sellerShare}% share)</strong></td></tr>`,
            `<tr><td>Minimum cash (5%)</td><td>${money(c.cash5)}</td></tr>`,
            `<tr><td>Balance CPF / cash (20%)</td><td>${money(c.cpfCash20)}</td></tr>`,
            `<tr><td>Bank loan (75%)</td><td>${money(c.bankLoan75)}</td></tr>`,
        )
        if (c.monthlyInstallment > 0) {
            buyerRows.push(`<tr class="highlight"><td>Est. monthly instalment</td><td>${money(c.monthlyInstallment)}</td></tr>`)
        }
    } else if (noLoan) {
        buyerRows.push(
            `<tr class="section-sep"><td colspan="2"><strong>No New Financing Required</strong></td></tr>`,
            `<tr><td>CPF OA used for purchase</td><td>${money(c.cpfUsedForPurchase)}</td></tr>`,
            `<tr><td>Cash required</td><td>${money(c.cashRequired)}</td></tr>`,
        )
    } else if (isRefi) {
        buyerRows.push(
            `<tr class="section-sep"><td colspan="2"><strong>Refinancing (${d.buyerShare}% share of existing loan)</strong></td></tr>`,
            `<tr><td>Loan portion to refinance</td><td>${money(c.buyerLoanLiability)}</td></tr>`,
        )
        if (c.refiMonthlyInstallment > 0) {
            buyerRows.push(`<tr class="highlight"><td>Est. monthly instalment</td><td>${money(c.refiMonthlyInstallment)}</td></tr>`)
        }
    }

    // Ownership structure post-decoupling
    buyerRows.push(
        `<tr class="section-sep"><td colspan="2"><strong>Ownership Structure (Post-Decoupling)</strong></td></tr>`,
        `<tr><td>Property valuation</td><td>${money(d.propertyValuation)}</td></tr>`,
        `<tr><td>Loan portion</td><td>${money(c.loanForStructure)} (${pct(c.loanPct)})</td></tr>`,
        `<tr><td>CPF used</td><td>${money(c.totalCpfUsed)} (${pct(c.cpfPct)})</td></tr>`,
        `<tr class="highlight"><td>Cash equity</td><td>${pct(c.cashPct)}</td></tr>`,
    )

    const buyerSection = `
      <section class="block">
        <h2>Buyer Perspective</h2>
        <table class="kv">
          ${buyerRows.join('')}
        </table>
      </section>`

    // ── Seller section ────────────────────────────────────────────────────────
    const sellerRows: string[] = [
        `<tr><td>Sale price (${sellerShare}% share)</td><td>${money(c.sellingPrice)}</td></tr>`,
        `<tr><td>Seller's loan liability (${sellerShare}%)</td><td>−${money(c.sellerLoanLiability)}</td></tr>`,
        `<tr><td>CPF used by seller (to refund)</td><td>−${money(w.seller_cpf_usage ?? 0)}</td></tr>`,
        `<tr><td>Legal fee (est.)</td><td>−${money(c.sellerLegalFee)}</td></tr>`,
    ]
    if (c.ssd > 0) {
        sellerRows.push(`<tr><td>Seller's Stamp Duty (SSD · ${c.ssdRatePct}%)</td><td>−${money(c.ssd)}</td></tr>`)
    }
    const cashProceedsPositive = c.cashProceeds >= 0
    sellerRows.push(`<tr class="highlight"><td>Estimated net cash proceeds</td><td>${cashProceedsPositive ? '' : '−'}${money(c.cashProceeds)}</td></tr>`)

    const cancelFeeNote = c.cancellationFee > 0
        ? `<p class="note">Note: estimated cancellation fee on undisbursed amount ≈ ${money(c.cancellationFee)}.</p>`
        : ''

    const sellerSection = `
      <section class="block">
        <h2>Seller Perspective</h2>
        <table class="kv">
          ${sellerRows.join('')}
        </table>
        ${cancelFeeNote}
      </section>`

    // ── TDSR section (not for S4) ─────────────────────────────────────────────
    let tdsrSection = ''
    if (c.scenario !== 'S4' && c.grossMonthlyIncome > 0) {
        const tdsrRows: string[] = [
            `<tr><td>Gross monthly income</td><td>${money(c.grossMonthlyIncome)}</td></tr>`,
            `<tr><td>Existing monthly commitments</td><td>${money(c.existingMonthlyDebts)}</td></tr>`,
            `<tr><td>Available TDSR headroom (55%)</td><td>${money(c.availableTdsr)}</td></tr>`,
        ]

        if (isRefi) {
            tdsrRows.push(
                `<tr class="section-sep"><td>Home loan stress instalment (4%)</td><td>${money(c.homeLoanStressInstallment)}</td></tr>`,
                `<tr><td>Refi TDSR ${c.refiTdsrPass ? '✓ Pass' : '✗ Fail'}</td><td>${money(c.refiStressInstallment)} required</td></tr>`,
            )
        }

        if (isPurchase) {
            const purchaseCapacity = c.scenario === 'S3' ? c.balanceTdsrForPurchase : c.availableTdsr
            tdsrRows.push(
                `<tr class="section-sep"><td>Purchase loan stress instalment (4%)</td><td>${money(c.purchaseStressInstallment)}</td></tr>`,
                `<tr><td>Available for purchase${c.scenario === 'S3' ? ' (after refi)' : ''}</td><td>${money(purchaseCapacity)}</td></tr>`,
                `<tr><td>Purchase TDSR ${c.purchaseTdsrPass ? '✓ Pass' : '✗ Fail'}</td><td></td></tr>`,
            )
        }

        const pledgeRows: string[] = []
        const pledges = [
            { label: 'Refi pledge', pledge: c.refiPledge },
            { label: 'Purchase pledge', pledge: c.purchasePledge },
        ].filter(p => p.pledge != null)
        pledges.forEach(({ label, pledge }) => {
            pledgeRows.push(`<tr><td>${label}: pledge</td><td>${money(pledge!.pledgeFund)} (locked 4 yrs) or show ${money(pledge!.showFund)}</td></tr>`)
        })

        tdsrSection = `
          <section class="block">
            <h2>TDSR Eligibility</h2>
            <table class="kv">
              ${tdsrRows.join('')}
              ${pledgeRows.join('')}
            </table>
          </section>`
    }

    // ── Equity loan section ───────────────────────────────────────────────────
    let equitySection = ''
    if (d.propertyValuation > 0) {
        const equityRows: string[] = [
            `<tr><td>Property valuation</td><td>${money(d.propertyValuation)}</td></tr>`,
            `<tr><td>75% LTV ceiling</td><td>${money(d.propertyValuation * 0.75)}</td></tr>`,
            `<tr><td>Loan portion (${pct(c.loanPct)})</td><td>${money(c.loanForStructure)}</td></tr>`,
            `<tr><td>CPF used (${pct(c.cpfPct)})</td><td>${money(c.totalCpfUsed)}</td></tr>`,
        ]
        if (c.equityEligible) {
            equityRows.push(
                `<tr class="highlight"><td>Equity loan headroom (LTV)</td><td>${money(c.equityLoanMaxLtv)}</td></tr>`,
            )
            if (w.equity_loan_amount && w.equity_loan_amount > 0) {
                equityRows.push(
                    `<tr><td>Requested equity loan</td><td>${money(w.equity_loan_amount)}</td></tr>`,
                    `<tr><td>Equity TDSR ${c.equityTdsrPass ? '✓ Pass' : '✗ Fail'}</td><td></td></tr>`,
                )
                if (c.equityPledge) {
                    equityRows.push(`<tr><td>To pass: pledge</td><td>${money(c.equityPledge.pledgeFund)} or show ${money(c.equityPledge.showFund)}</td></tr>`)
                }
            }
        } else {
            equityRows.push(`<tr><td>Equity loan eligibility</td><td>Not eligible${c.equityNotEligibleReason ? ` — ${esc(c.equityNotEligibleReason)}` : ''}</td></tr>`)
        }
        equitySection = `
          <section class="block">
            <h2>Equity Loan Headroom</h2>
            <table class="kv">${equityRows.join('')}</table>
          </section>`
    }

    // ── Remarks ───────────────────────────────────────────────────────────────
    const remarks: string[] = [
        'Stamp duties shown are estimates based on prevailing IRAS rates — verify exact amounts with your solicitor before committing.',
        'Cancellation fee (if applicable) is approximately 0.75% of the undisbursed loan amount and depends on the bank\'s Letter of Offer.',
        'Monthly instalments are estimated at the reference rate entered — actual rates are subject to bank assessment.',
        'All figures are for discussion only and are not a formal offer of credit.',
    ]
    if (c.ssd > 0) {
        remarks.unshift(`Seller's Stamp Duty (SSD) of ${money(c.ssd)} applies — the seller has held the property for less than 4 years.`)
    }

    return `<!doctype html><html><head><meta charset="utf-8"><title>Decoupling Plan${d.clientName ? ` — ${esc(d.clientName)}` : ''}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e293b; margin: 0; padding: 32px 36px; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 13px; }
  h1 { font-size: 22px; color: #052d4a; margin: 0; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #03a9e7; margin: 0 0 10px; }
  .cover { border-bottom: 3px solid #03a9e7; padding-bottom: 14px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-end; }
  .cover .meta { text-align: right; font-size: 12px; color: #64748b; line-height: 1.6; }
  .lede { font-size: 13px; color: #475569; margin: 4px 0 0; }
  .summary { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 14px 18px; margin-bottom: 22px; display: flex; gap: 24px; flex-wrap: wrap; }
  .summary div span { display: block; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .summary div b { font-size: 15px; color: #052d4a; }
  .scenario-badge { display: inline-block; background: #052d4a; color: #fff; font-size: 11px; font-weight: 600; padding: 4px 10px; border-radius: 20px; margin-bottom: 20px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 22px; }
  .block { margin-bottom: 22px; page-break-inside: avoid; }
  table.kv { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.kv td { padding: 7px 4px; border-top: 1px solid #f1f5f9; color: #334155; }
  table.kv td:last-child { text-align: right; font-weight: 600; color: #052d4a; }
  table.kv tr.highlight td { background: #f0fdf4; }
  table.kv tr.highlight td:last-child { color: #047857; }
  table.kv tr.section-sep td { padding-top: 14px; border-top: 2px solid #e2e8f0; color: #052d4a; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  ul.notes { margin: 0; padding-left: 18px; font-size: 12px; color: #334155; line-height: 1.6; }
  ul.notes li { margin: 5px 0; }
  .note { font-size: 11.5px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 7px 10px; margin-top: 10px; }
  .disclaimer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10.5px; color: #94a3b8; line-height: 1.5; }
  @page { margin: 16mm; }
</style></head>
<body>
  <div class="cover">
    <div>
      <h1>Your Decoupling Plan</h1>
      <p class="lede">${d.clientName ? `Prepared for ${esc(d.clientName)}` : 'Mortgage decoupling summary'}</p>
    </div>
    <div class="meta">
      ${d.advisorName ? `Advisor: ${esc(d.advisorName)}<br>` : ''}
      ${today}
    </div>
  </div>

  <div class="summary">
    <div><span>Property</span><b>${esc(d.propertyLabel)}</b></div>
    <div><span>Valuation</span><b>${money(d.propertyValuation)}</b></div>
    <div><span>Buyer acquires</span><b>${sellerShare}% share</b></div>
    ${c.weightedAge ? `<div><span>Weighted age</span><b>${c.weightedAge} yrs</b></div>` : ''}
  </div>

  ${c.scenario ? `<div class="scenario-badge">Scenario: ${esc(scenarioLabel)}</div>` : ''}

  <div class="cols">
    ${buyerSection}
    ${sellerSection}
  </div>

  ${tdsrSection}
  ${equitySection}

  <section class="block">
    <h2>Key Things to Note</h2>
    <ul class="notes">${remarks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
  </section>

  <div class="disclaimer">
    All figures are estimates for discussion only and are subject to the bank's formal assessment and approval. Stamp duties follow prevailing IRAS rates — verify with your solicitor before committing.
  </div>
</body></html>`
}
