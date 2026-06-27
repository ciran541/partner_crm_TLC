/**
 * Shared presentation engine — the SINGLE source of truth for every client-facing
 * document (Refinancing, Purchase, Decouple, Equity Loan).
 *
 * Each workflow's builder composes sections with the helpers here and wraps them in
 * `renderPresentation()`. The on-screen "Present to client" modal renders the exact
 * same HTML in an iframe, and the emailed/printed PDF uses the same string — so the
 * screen, the print, and the email can never drift apart again.
 */

import type { AmortRow } from '@/lib/insurance/amortCalc'

export const money = (n: number) => `$${Math.round(n).toLocaleString()}`
export const esc = (s: string) =>
    String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))

export interface CoverStat { label: string; value: string }

// ── Document shell ──────────────────────────────────────────────────────────

export function renderPresentation(opts: {
    planLabel: string            // eye-brow, e.g. "Refinancing Plan"
    docTitle: string             // <title>
    heading: string              // "Prepared for X" / "Your refinancing summary"
    advisorName?: string
    coverStats: CoverStat[]
    bodyHtml: string             // concatenated section HTML
    disclaimer: string
    /** Include the auto-print script (for the "open in new window" path). The email
     *  PDF generator strips scripts, so this is harmless there. */
    autoPrint?: boolean
}): string {
    const today = new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
    const stats = opts.coverStats
        .filter(s => s.value)
        .map(s => `<div class="cstat"><span>${esc(s.label)}</span><b>${esc(s.value)}</b></div>`)
        .join('')

    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.docTitle)}</title>
<style>${STYLES}</style></head>
<body>
  <div class="doc">
    <header class="cover">
      <div class="cover-band"></div>
      <p class="eyebrow">${esc(opts.planLabel)}</p>
      <h1>${esc(opts.heading)}</h1>
      <div class="cover-stats">${stats}</div>
      <div class="cover-foot">
        ${opts.advisorName ? `<span>Prepared by <b>${esc(opts.advisorName)}</b></span>` : '<span>The Loan Connection</span>'}
        <span>${today}</span>
      </div>
    </header>

    <main class="body">
      ${opts.bodyHtml}
      <p class="disclaimer">${esc(opts.disclaimer)}</p>
    </main>
  </div>
  ${opts.autoPrint ? `<script>window.onload=function(){setTimeout(function(){window.print();},200);};</script>` : ''}
</body></html>`
}

// ── Section helpers ─────────────────────────────────────────────────────────

/** A titled section card. */
export function section(title: string, subtitle: string | undefined, innerHtml: string): string {
    return `<section class="card">
    <div class="card-head">
      <h2>${esc(title)}</h2>
      ${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
    </div>
    ${innerHtml}
  </section>`
}

export interface PackageCardData {
    bank?: string
    package_name?: string
    category?: string
    lockin_years?: number
    scheduleLines?: string[]              // pre-formatted rate-schedule display lines
    style?: 'flexi' | 'traditional' | null
    features?: string[]
    current_monthly?: number | null
    projected_monthly?: number | null
    monthly_saving?: number | null
    net_saving_2yr?: number | null
}

/** The recommended-package block — mirrors the Step-4 card: header, big saving/monthly,
 *  per-year rate schedule, Flexi/Traditional, features, and the monthly figures. */
export function packageCard(pkg: PackageCardData): string {
    const header = `${esc(pkg.bank ?? '')}${pkg.category ? ` · ${esc(pkg.category)}` : ''}${
        pkg.lockin_years ? ` · ${pkg.lockin_years}-year lock-in` : ' · No lock-in'}`

    const hero = pkg.monthly_saving != null && pkg.monthly_saving > 0
        ? `<div class="pkg-hero"><b>${money(pkg.monthly_saving)}</b><span>Est. monthly saving</span></div>`
        : pkg.projected_monthly != null
            ? `<div class="pkg-hero alt"><b>${money(pkg.projected_monthly)}</b><span>Est. monthly</span></div>`
            : ''

    const styleBadge = pkg.style
        ? `<span class="badge ${pkg.style === 'flexi' ? 'badge-flexi' : 'badge-trad'}">${pkg.style === 'flexi' ? 'Flexi' : 'Traditional'}</span>`
        : ''

    const sched = pkg.scheduleLines?.length
        ? `<ul class="sched">${pkg.scheduleLines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
        : ''

    const features = pkg.features?.length
        ? `<ul class="features">${pkg.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
        : ''

    const figures: string[] = []
    if (pkg.current_monthly != null) figures.push(`<span>Current monthly <b>${money(pkg.current_monthly)}</b></span>`)
    if (pkg.projected_monthly != null) figures.push(`<span>New monthly <b class="navy">${money(pkg.projected_monthly)}</b></span>`)
    if (pkg.net_saving_2yr != null) figures.push(`<span>2-yr net saving <b class="green">${money(pkg.net_saving_2yr)}</b></span>`)

    return `<div class="pkg">
    <div class="pkg-top">
      <div>
        <p class="pkg-name">${header} ${styleBadge}</p>
        ${pkg.package_name ? `<p class="pkg-sub">${esc(pkg.package_name)}</p>` : ''}
      </div>
      ${hero}
    </div>
    ${sched}
    ${features ? `<div class="pkg-features"><p class="mini-label">Features</p>${features}</div>` : ''}
    ${figures.length ? `<div class="pkg-figures">${figures.join('')}</div>` : ''}
  </div>`
}

/** Per-year instalment & interest breakdown over the lock-in (or first N years). */
export function instalmentBreakdown(opts: {
    rows: AmortRow[]
    lockinYears?: number
    monthly?: number | null
    tenureYears?: number
}): string {
    const span = opts.lockinYears && opts.lockinYears > 0 ? opts.lockinYears : Math.min(3, opts.rows.length)
    const rows = opts.rows.filter(r => r.instalment != null).slice(0, span)
    if (!rows.length) return ''

    const lockinInterest = rows.reduce((s, r) => s + (r.yearInterest ?? 0), 0)
    const body = rows.map(r => `
      <tr>
        <td>Year ${r.year}</td>
        <td>${r.rate != null ? `${r.rate.toFixed(2)}%` : '—'}</td>
        <td>${r.instalment != null ? money(r.instalment) : '—'}</td>
        <td>${r.yearInterest != null ? money(r.yearInterest) : '—'}</td>
        <td>${r.balance != null ? money(r.balance) : '—'}</td>
      </tr>`).join('')

    const head = opts.monthly != null
        ? `<div class="inst-hero"><b>${money(opts.monthly)}</b><span>Est. monthly instalment${opts.tenureYears ? ` · ${opts.tenureYears}-yr tenure` : ''}</span></div>`
        : ''

    return `${head}
    <table class="amort">
      <thead><tr><th>Year</th><th>Rate</th><th>Monthly</th><th>Interest / yr</th><th>Balance</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="amort-foot">Total interest over the ${span === 1 ? 'first year' : `first ${span} years`}: <b>${money(lockinInterest)}</b>. Instalments recompute as the rate steps; figures are estimates at today's SORA.</p>`
}

/** A simple label/value table (costs, key figures). The last row can be a total. */
export function kvTable(rows: { label: string; value: string; total?: boolean; good?: boolean }[]): string {
    if (!rows.length) return ''
    return `<table class="kv">${rows.map(r => `
      <tr class="${r.total ? 'total' : ''}${r.good ? ' good' : ''}">
        <td>${esc(r.label)}</td><td>${esc(r.value)}</td>
      </tr>`).join('')}</table>`
}

/** Key things to note — amber alerts first, then bullet notes. */
export function notesBlock(alerts: string[], notes: string[]): string {
    const a = alerts.map(x => `<div class="alert">${esc(x)}</div>`).join('')
    const n = notes.length ? `<ul class="notes">${notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''
    return a + n
}

// ── Styles ──────────────────────────────────────────────────────────────────

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1e293b; background: #f1f5f9; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc { max-width: 820px; margin: 0 auto; background: #fff; }

  /* Cover */
  .cover { position: relative; background: linear-gradient(135deg, #052d4a 0%, #0a4a78 100%);
    color: #fff; padding: 34px 40px 28px; overflow: hidden; }
  .cover-band { position: absolute; right: -60px; top: -60px; width: 220px; height: 220px;
    background: radial-gradient(circle, rgba(3,169,231,.35), transparent 70%); }
  .eyebrow { margin: 0 0 6px; color: #7dd3fc; font-size: 11px; font-weight: 700;
    text-transform: uppercase; letter-spacing: .18em; }
  .cover h1 { margin: 0; font-size: 26px; font-weight: 800; line-height: 1.2; }
  .cover-stats { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 26px; }
  .cstat span { display: block; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: rgba(255,255,255,.6); }
  .cstat b { font-size: 15px; font-weight: 700; }
  .cover-foot { margin-top: 22px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,.15);
    display: flex; justify-content: space-between; font-size: 11.5px; color: rgba(255,255,255,.75); }
  .cover-foot b { color: #fff; }

  /* Body + cards */
  .body { padding: 28px 40px 36px; }
  .card { margin-bottom: 22px; page-break-inside: avoid; }
  .card-head { margin-bottom: 12px; }
  .card h2 { margin: 0; font-size: 16px; font-weight: 800; color: #052d4a; }
  .card .sub { margin: 3px 0 0; font-size: 12.5px; color: #64748b; }

  /* Package card */
  .pkg { border: 1px solid #e2e8f0; border-left: 4px solid #03a9e7; border-radius: 12px; padding: 16px 18px; }
  .pkg-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .pkg-name { margin: 0; font-size: 15px; font-weight: 800; color: #052d4a; }
  .pkg-sub { margin: 3px 0 0; font-size: 12.5px; color: #64748b; }
  .pkg-hero { text-align: right; flex-shrink: 0; }
  .pkg-hero b { display: block; font-size: 22px; font-weight: 800; color: #059669; line-height: 1; }
  .pkg-hero.alt b { color: #03a9e7; }
  .pkg-hero span { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #94a3b8; }
  .badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 999px; vertical-align: middle; }
  .badge-flexi { color: #0277a8; background: #e0f2fe; border: 1px solid #7dd3fc; }
  .badge-trad { color: #64748b; background: #f1f5f9; border: 1px solid #e2e8f0; }
  ul.sched { margin: 12px 0 0; padding-left: 18px; font-size: 12.5px; color: #334155; columns: 2; column-gap: 28px; }
  ul.sched li { margin: 2px 0; }
  .pkg-features { margin-top: 12px; }
  .mini-label { margin: 0 0 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #94a3b8; }
  ul.features { margin: 0; padding-left: 18px; font-size: 12px; color: #475569; }
  ul.features li { margin: 2px 0; list-style: '\\2713  '; }
  .pkg-figures { margin-top: 14px; padding-top: 12px; border-top: 1px solid #f1f5f9; display: flex; flex-wrap: wrap; gap: 22px; font-size: 12.5px; color: #64748b; }
  .pkg-figures b { color: #334155; } .pkg-figures b.navy { color: #052d4a; } .pkg-figures b.green { color: #059669; }

  /* Instalment hero + amortization */
  .inst-hero { display: inline-flex; flex-direction: column; background: #052d4a; color: #fff;
    border-radius: 12px; padding: 12px 18px; margin-bottom: 14px; }
  .inst-hero b { font-size: 22px; font-weight: 800; line-height: 1; }
  .inst-hero span { font-size: 11px; color: rgba(255,255,255,.7); margin-top: 4px; }
  table.amort { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  table.amort th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em;
    color: #94a3b8; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
  table.amort th:not(:first-child), table.amort td:not(:first-child) { text-align: right; }
  table.amort td { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  table.amort td:last-child { color: #64748b; }
  .amort-foot { margin: 10px 0 0; font-size: 11.5px; color: #64748b; }
  .amort-foot b { color: #052d4a; }

  /* KV / costs table */
  table.kv { width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  table.kv td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
  table.kv td:last-child { text-align: right; font-weight: 700; color: #052d4a; }
  table.kv tr:last-child td { border-bottom: none; }
  table.kv tr.total td { background: #f8fafc; border-top: 2px solid #052d4a; font-weight: 800; font-size: 14px; }
  table.kv tr.good td:last-child { color: #059669; }
  table.kv tr.section-sep td { padding-top: 13px; border-top: 2px solid #e2e8f0; background: #fff;
    color: #052d4a; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  table.kv tr.section-sep td:last-child { color: #052d4a; }
  table.kv tr.highlight td { background: #f0fdf4; }
  table.kv tr.highlight td:last-child { color: #059669; }

  /* Notes */
  .alert { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 11px 14px;
    font-size: 12.5px; color: #92400e; margin-bottom: 10px; line-height: 1.5; }
  ul.notes { margin: 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.6; }
  ul.notes li { margin: 6px 0; }

  /* Financing options (Purchase) */
  .opts { display: flex; gap: 14px; }
  .opt { flex: 1; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
  .opt-head { background: #052d4a; color: #fff; padding: 11px 15px; }
  .opt-title { font-size: 15px; font-weight: 800; }
  .opt-sub { font-size: 11px; opacity: .8; }
  .opt-loan { padding: 13px 15px 4px; font-size: 22px; font-weight: 800; color: #03a9e7; line-height: 1; }
  .opt-loan span { display: block; font-size: 10px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; margin-top: 4px; }
  .opt table.kv { border: none; border-radius: 0; margin-top: 8px; }
  .opt table.kv td { padding: 7px 15px; font-size: 12px; }
  .pledge { margin: 4px 15px 14px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
    padding: 8px 11px; font-size: 11px; color: #92400e; line-height: 1.5; }

  .disclaimer { margin: 24px 0 0; padding-top: 14px; border-top: 1px solid #e2e8f0;
    font-size: 10.5px; color: #94a3b8; line-height: 1.55; }

  @page { margin: 0; }
  @media print { body { background: #fff; } .doc { max-width: none; } }
`
