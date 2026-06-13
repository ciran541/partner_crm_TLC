/**
 * Print / "Save as PDF" document for the New Purchase face-to-face presentation.
 *
 * The on-screen presentation (PurchasePresentation.tsx) is what the agent walks
 * the client through at the table; this produces the matching clean, self-contained
 * HTML the agent can print or save as a PDF leave-behind. It opens in its own
 * window so it prints in isolation from the app chrome.
 */

import type { PurchaseComputation, OptionResult } from '@/lib/insurance/purchaseCalc'
import type { PurchaseRemarks } from '@/lib/insurance/purchaseRemarks'
import type { ProposalPackage } from '@/lib/insurance/purchaseProposal'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'

export interface PresentationData {
  clientName?: string
  advisorName?: string
  propertyLabel: string
  price: number
  referenceRate?: number
  computation: PurchaseComputation
  remarks: PurchaseRemarks
  selectedPackage?: ProposalPackage | null
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct = (frac: number) => {
  const v = frac * 100
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`
}
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

function optionColumn(opt: OptionResult): string {
  const downTotal = opt.minCashDown + opt.cashCpfDown
  const pledge = opt.pledge
    ? `<div class="pledge">To reach the full ${pct(opt.ltvPct)}, pledge ${money(opt.pledge.pledgeFund)} (locked 4 yrs) or show ${money(opt.pledge.showFund)} in funds.</div>`
    : ''
  return `
      <div class="opt">
        <div class="opt-head">
          <div class="opt-title">Option ${opt.key}</div>
          <div class="opt-sub">${pct(opt.ltvPct)} LTV · tenure to age ${opt.ageCap}</div>
        </div>
        <div class="opt-loan">${money(opt.finalLoan)}<span>maximum bank loan</span></div>
        <table class="kv">
          <tr><td>Loan tenure</td><td>${opt.tenure} years</td></tr>
          <tr><td>Est. monthly instalment</td><td>${money(opt.installment)}</td></tr>
          <tr><td>Minimum cash (${pct(opt.minCashPct)})</td><td>${money(opt.minCashDown)}</td></tr>
          <tr><td>Balance cash / CPF (${pct(opt.cashCpfPct)})</td><td>${money(opt.cashCpfDown)}</td></tr>
          <tr class="total"><td>Total downpayment</td><td>${money(downTotal)}</td></tr>
        </table>
        ${pledge}
      </div>`
}

function packageBlock(pkg: ProposalPackage): string {
  const header = `${esc(pkg.bank ?? '')}${pkg.category ? ` · ${esc(pkg.category)}` : ''}${pkg.lockin_years ? ` · ${pkg.lockin_years}-year lock-in` : ' · No lock-in'}`
  const sched = pkg.rate_schedule?.length
    ? `<ul class="sched">${formatRateSchedule(pkg.rate_schedule).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
    : pkg.year1_rate != null ? `<ul class="sched"><li>Year 1: ${pkg.year1_rate.toFixed(2)}%</li></ul>` : ''
  const monthly = pkg.projected_monthly != null ? `<div class="pkg-monthly">Est. monthly instalment <b>${money(pkg.projected_monthly)}</b></div>` : ''
  return `
      <section class="block">
        <h2>Recommended Package</h2>
        <div class="pkg">
          <div class="pkg-name">${header}</div>
          ${pkg.package_name ? `<div class="pkg-sub">${esc(pkg.package_name)}</div>` : ''}
          ${sched}
          ${monthly}
        </div>
      </section>`
}

export function buildPresentationHtml(d: PresentationData): string {
  const { computation: c } = d
  const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })

  const optionCols = c.options.map(optionColumn).join('')
  const feesTotal = c.bsd + c.absd + c.legalFee + c.valuationFee

  const remarks = [...d.remarks.alerts, ...d.remarks.standard, ...d.remarks.propertyType]
  const remarksHtml = remarks.length
    ? `<section class="block"><h2>Key Things to Note</h2><ul class="notes">${remarks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>`
    : ''

  const pkgHtml = d.selectedPackage?.bank ? packageBlock(d.selectedPackage) : ''

  return `<!doctype html><html><head><meta charset="utf-8"><title>Home Financing Plan${d.clientName ? ` — ${esc(d.clientName)}` : ''}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e293b; margin: 0; padding: 32px 36px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 22px; color: #052d4a; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #03a9e7; margin: 0 0 10px; }
  .cover { border-bottom: 3px solid #03a9e7; padding-bottom: 14px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-end; }
  .cover .meta { text-align: right; font-size: 12px; color: #64748b; line-height: 1.5; }
  .lede { font-size: 13px; color: #475569; margin: 4px 0 0; }
  .summary { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; display: flex; gap: 28px; }
  .summary div span { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .summary div b { font-size: 16px; color: #052d4a; }
  .block { margin-bottom: 24px; page-break-inside: avoid; }
  .opts { display: flex; gap: 16px; }
  .opt { flex: 1; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
  .opt-head { background: #052d4a; color: #fff; padding: 10px 14px; }
  .opt-title { font-size: 15px; font-weight: 700; }
  .opt-sub { font-size: 11px; opacity: .85; }
  .opt-loan { padding: 12px 14px 6px; font-size: 22px; font-weight: 800; color: #03a9e7; }
  .opt-loan span { display: block; font-size: 11px; font-weight: 500; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
  table.kv { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.kv td { padding: 6px 14px; border-top: 1px solid #f1f5f9; }
  table.kv td:last-child { text-align: right; font-weight: 600; color: #052d4a; }
  table.kv tr.total td { border-top: 2px solid #e2e8f0; font-weight: 700; }
  .pledge { margin: 8px 14px 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; font-size: 11.5px; color: #92400e; }
  table.costs { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.costs td { padding: 9px 4px; border-bottom: 1px solid #f1f5f9; }
  table.costs td:last-child { text-align: right; font-weight: 600; color: #052d4a; }
  table.costs tr.grand td { border-top: 2px solid #052d4a; border-bottom: none; font-weight: 800; font-size: 14px; padding-top: 11px; }
  .pkg { border: 1px solid #e2e8f0; border-left: 4px solid #03a9e7; border-radius: 8px; padding: 14px 16px; }
  .pkg-name { font-weight: 700; color: #052d4a; font-size: 14px; }
  .pkg-sub { color: #64748b; font-size: 12.5px; margin-top: 2px; }
  ul.sched { margin: 10px 0 0; padding-left: 18px; font-size: 12.5px; color: #334155; }
  ul.sched li { margin: 2px 0; }
  .pkg-monthly { margin-top: 10px; font-size: 13px; color: #334155; }
  ul.notes { margin: 0; padding-left: 18px; font-size: 12.5px; color: #334155; line-height: 1.55; }
  ul.notes li { margin: 6px 0; }
  .disclaimer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10.5px; color: #94a3b8; line-height: 1.5; }
  @page { margin: 16mm; }
</style></head>
<body>
  <div class="cover">
    <div>
      <h1>Your Home Financing Plan</h1>
      <p class="lede">${d.clientName ? `Prepared for ${esc(d.clientName)}` : 'Mortgage advisory summary'}</p>
    </div>
    <div class="meta">
      ${d.advisorName ? `Advisor: ${esc(d.advisorName)}<br>` : ''}
      ${today}
    </div>
  </div>

  <div class="summary">
    <div><span>Property</span><b>${esc(d.propertyLabel)}</b></div>
    <div><span>Purchase price</span><b>${money(d.price)}</b></div>
    ${c.weightedAge ? `<div><span>Avg. borrower age</span><b>${c.weightedAge}</b></div>` : ''}
  </div>

  <section class="block">
    <h2>Your Financing Options</h2>
    <div class="opts">${optionCols}</div>
  </section>

  ${pkgHtml}

  <section class="block">
    <h2>Upfront Costs</h2>
    <table class="costs">
      <tr><td>Buyer's Stamp Duty (BSD)</td><td>${money(c.bsd)}</td></tr>
      <tr><td>Additional Buyer's Stamp Duty (ABSD${c.absdRatePct ? ` · ${c.absdRatePct % 1 === 0 ? c.absdRatePct : c.absdRatePct.toFixed(1)}%` : ''})</td><td>${money(c.absd)}</td></tr>
      <tr><td>Legal fee (est.)</td><td>${money(c.legalFee)}</td></tr>
      <tr><td>Valuation fee (est.)</td><td>${money(c.valuationFee)}</td></tr>
      <tr class="grand"><td>Total stamp duty &amp; fees</td><td>${money(feesTotal)}</td></tr>
    </table>
  </section>

  ${remarksHtml}

  <div class="disclaimer">
    All figures are estimates for discussion only and are subject to the bank's formal assessment and approval. Stamp duties follow prevailing IRAS rates. ${d.referenceRate ? `Monthly instalments are estimated at ${d.referenceRate}% p.a.` : ''}
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>
</body></html>`
}
