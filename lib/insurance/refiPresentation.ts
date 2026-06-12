/**
 * Print / "Save as PDF" document for the Refinancing face-to-face presentation.
 * Matches the on-screen presentation (RefiPresentation.tsx); opens in its own
 * window so it prints in isolation from the app chrome.
 */

import type { RefiComputation } from '@/lib/insurance/refiCalc'
import type { RefiRemarks } from '@/lib/insurance/refiRemarks'
import type { RefiProposalPackage } from '@/lib/insurance/refiProposal'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'

export interface RefiPresentationData {
    clientName?: string
    propertyLabel: string
    currentBank?: string
    currentRatePct?: number
    totalOutstanding: number
    computation: RefiComputation
    remarks: RefiRemarks
    selectedPackage?: RefiProposalPackage | null
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

function packageBlock(pkg: RefiProposalPackage): string {
    const header = `${esc(pkg.bank ?? '')}${pkg.category ? ` · ${esc(pkg.category)}` : ''}${pkg.lockin_years ? ` · ${pkg.lockin_years}-year lock-in` : ' · No lock-in'}`
    const sched = pkg.rate_schedule?.length
        ? `<ul class="sched">${formatRateSchedule(pkg.rate_schedule).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
        : pkg.year1_rate != null ? `<ul class="sched"><li>Year 1: ${pkg.year1_rate.toFixed(2)}%</li></ul>` : ''
    const rows: string[] = []
    if (pkg.current_monthly != null) rows.push(`<tr><td>Current monthly</td><td>${money(pkg.current_monthly)}</td></tr>`)
    if (pkg.projected_monthly != null) rows.push(`<tr><td>New monthly</td><td>${money(pkg.projected_monthly)}</td></tr>`)
    if (pkg.monthly_saving != null) rows.push(`<tr class="save"><td>Estimated monthly saving</td><td>${money(pkg.monthly_saving)}</td></tr>`)
    if (pkg.net_saving_2yr != null) rows.push(`<tr><td>Estimated 2-year net saving</td><td>${money(pkg.net_saving_2yr)}</td></tr>`)
    return `
      <section class="block">
        <h2>Recommended Package</h2>
        <div class="pkg">
          <div class="pkg-name">${header}</div>
          ${pkg.package_name ? `<div class="pkg-sub">${esc(pkg.package_name)}</div>` : ''}
          ${sched}
          ${rows.length ? `<table class="kv">${rows.join('')}</table>` : ''}
        </div>
      </section>`
}

export function buildRefiPresentationHtml(d: RefiPresentationData): string {
    const c = d.computation
    const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })

    const tenureHtml = c.tenure && !c.tenure.error
        ? `<section class="block"><h2>Refinancing Tenure Range</h2>
             <div class="tenure"><b>${c.tenure.min} – ${c.tenure.max} years</b><span>based on ${c.usingIwaa ? 'income-weighted average age' : 'average age'} ${c.ageForTenure != null ? Math.ceil(c.ageForTenure) : ''}</span></div>
           </section>`
        : ''

    const costHtml = d.remarks.cost.length
        ? `<section class="block"><h2>Cost of Refinancing</h2><ul class="notes">${d.remarks.cost.map(l => `<li>${esc(l)}</li>`).join('')}</ul></section>`
        : ''

    const remarks = [...d.remarks.alerts, ...d.remarks.standard, ...d.remarks.conditional]
    const remarksHtml = remarks.length
        ? `<section class="block"><h2>Key Things to Note</h2><ul class="notes">${remarks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>`
        : ''

    const pkgHtml = d.selectedPackage?.bank ? packageBlock(d.selectedPackage) : ''

    return `<!doctype html><html><head><meta charset="utf-8"><title>Refinancing Plan${d.clientName ? ` — ${esc(d.clientName)}` : ''}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e293b; margin: 0; padding: 32px 36px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 22px; color: #052d4a; margin: 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #03a9e7; margin: 0 0 10px; }
  .cover { border-bottom: 3px solid #03a9e7; padding-bottom: 14px; margin-bottom: 22px; display: flex; justify-content: space-between; align-items: flex-end; }
  .cover .meta { text-align: right; font-size: 12px; color: #64748b; line-height: 1.5; }
  .lede { font-size: 13px; color: #475569; margin: 4px 0 0; }
  .summary { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; display: flex; gap: 28px; flex-wrap: wrap; }
  .summary div span { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .summary div b { font-size: 16px; color: #052d4a; }
  .block { margin-bottom: 24px; page-break-inside: avoid; }
  .tenure { background: #052d4a; color: #fff; border-radius: 12px; padding: 16px 20px; }
  .tenure b { font-size: 24px; }
  .tenure span { display: block; font-size: 12px; opacity: .8; margin-top: 2px; }
  .pkg { border: 1px solid #e2e8f0; border-left: 4px solid #03a9e7; border-radius: 8px; padding: 14px 16px; }
  .pkg-name { font-weight: 700; color: #052d4a; font-size: 14px; }
  .pkg-sub { color: #64748b; font-size: 12.5px; margin-top: 2px; }
  ul.sched { margin: 10px 0 0; padding-left: 18px; font-size: 12.5px; color: #334155; }
  ul.sched li { margin: 2px 0; }
  table.kv { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
  table.kv td { padding: 7px 4px; border-top: 1px solid #f1f5f9; }
  table.kv td:last-child { text-align: right; font-weight: 600; color: #052d4a; }
  table.kv tr.save td { color: #047857; font-weight: 800; }
  ul.notes { margin: 0; padding-left: 18px; font-size: 12.5px; color: #334155; line-height: 1.55; }
  ul.notes li { margin: 6px 0; }
  .disclaimer { margin-top: 26px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10.5px; color: #94a3b8; line-height: 1.5; }
  @page { margin: 16mm; }
</style></head>
<body>
  <div class="cover">
    <div>
      <h1>Your Refinancing Plan</h1>
      <p class="lede">${d.clientName ? `Prepared for ${esc(d.clientName)}` : 'Mortgage refinancing summary'}</p>
    </div>
    <div class="meta">${today}</div>
  </div>

  <div class="summary">
    <div><span>Property</span><b>${esc(d.propertyLabel)}</b></div>
    <div><span>Outstanding</span><b>${money(d.totalOutstanding)}</b></div>
    ${d.currentBank ? `<div><span>Current bank</span><b>${esc(d.currentBank)}</b></div>` : ''}
    ${d.currentRatePct ? `<div><span>Current rate</span><b>${d.currentRatePct}%</b></div>` : ''}
  </div>

  ${pkgHtml}
  ${tenureHtml}
  ${costHtml}
  ${remarksHtml}

  <div class="disclaimer">
    All figures are estimates for discussion only and are subject to the bank's formal assessment and approval. Savings compare the current rate against the recommended package over the same outstanding loan and tenure.
  </div>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>
</body></html>`
}
