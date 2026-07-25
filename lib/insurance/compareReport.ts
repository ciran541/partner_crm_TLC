/**
 * Package-comparison client document. Composes the shared presentation engine
 * (presentationShell.ts) so the on-screen compare modal, the exported PDF, and the
 * emailed PDF are the same brand — and priced from the same rate engine as Step 4.
 */

import type { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { effectiveRate, projectPackage } from '@/lib/insurance/rateRecommend'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import { shortLoan, stripBankPrefix, packageStyle } from '@/lib/insurance/rateFilters'
import { renderPresentation, section, money, esc, type CoverStat } from '@/lib/insurance/presentationShell'

export interface CompareReportData {
    packages: MortgagePackage[]
    sora: SoraRates | null
    loan: number | null
    tenureYears: number | null
    clientName?: string
    advisorName?: string
    autoPrint?: boolean
}

const pct = (n: number | null) => (n != null ? `${n.toFixed(2)}%` : '—')

/** Index of the single lowest value, or -1 on a tie / fewer than two numbers. */
function lowestIndex(values: (number | null)[]): number {
    const valid = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null)
    if (valid.length < 2) return -1
    const min = Math.min(...valid.map(x => x.v))
    const winners = valid.filter(x => x.v === min)
    return winners.length === 1 ? winners[0].i : -1
}

function rateText(e: RateScheduleEntry): string {
    return formatRateEntry(e).split(': ').slice(1).join(': ')
}

// ── Inline styles (presentationShell's <style> is fixed, so the comparison table
//    carries its own; inline styles print correctly through Chromium). ──
const S = {
    label: 'padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;font-weight:700;border-bottom:1px solid #f1f5f9;white-space:nowrap;vertical-align:top;',
    head: 'padding:10px;border-bottom:2px solid #052d4a;text-align:left;vertical-align:bottom;',
    cell: 'padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:top;font-size:12.5px;',
    sep: 'padding:11px 10px 6px;border-bottom:1px solid #e2e8f0;color:#052d4a;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;',
    best: 'color:#03a9e7;font-weight:800;',
}

export function buildCompareReportHtml(d: CompareReportData): string {
    const pkgs = d.packages
    const n = pkgs.length
    const { sora, loan, tenureYears } = d
    const priced = loan != null && tenureYears != null
    const projections = pkgs.map(p => (priced ? projectPackage(p, loan!, tenureYears!, sora) : null))

    // Years present across all compared packages, so rows line up by year.
    const maxYear = pkgs.reduce((m, p) => Math.max(m, ...p.rate_schedule
        .filter(e => !e.thereafter && typeof e.year === 'number')
        .map(e => e.year as number)), 0)
    const anyThereafter = pkgs.some(p => p.rate_schedule.some(e => e.thereafter))

    const row = (label: string, cells: string[], bestIdx = -1) => `<tr>
      <td style="${S.label}">${esc(label)}</td>
      ${cells.map((c, i) => `<td style="${S.cell}${i === bestIdx ? S.best : ''}">${c}</td>`).join('')}
    </tr>`

    const sepRow = (label: string) => `<tr><td style="${S.sep}" colspan="${n + 1}">${esc(label)}</td></tr>`

    const body: string[] = []

    // Header — bank + package name per column.
    body.push(`<tr>
      <td style="${S.head}"></td>
      ${pkgs.map(p => `<td style="${S.head}">
        <div style="font-size:14px;font-weight:800;color:#052d4a;">${esc(p.bank)}</div>
        <div style="font-size:11px;color:#64748b;font-weight:500;">${esc(stripBankPrefix(p.package_name, p.bank))}</div>
      </td>`).join('')}
    </tr>`)

    // Year-1 effective rate — highlight the lowest.
    const y1 = pkgs.map(p => (p.rate_schedule[0] ? effectiveRate(p.rate_schedule[0], sora).rate : null))
    body.push(row('Year-1 rate', y1.map(pct), lowestIndex(y1)))

    body.push(row('Lock-in', pkgs.map(p => (p.lockin_years ? `${p.lockin_years} year${p.lockin_years !== 1 ? 's' : ''}` : 'None'))))
    body.push(row('Property', pkgs.map(p => esc(p.property_type))))
    body.push(row('Min. loan', pkgs.map(p => shortLoan(p.min_loan_size))))
    body.push(row('Style', pkgs.map(p => {
        const st = packageStyle(p)
        return st ? (st === 'flexi' ? 'Flexi' : 'Traditional') : '—'
    })))

    // Rate schedule, aligned by year.
    body.push(sepRow('Rate schedule'))
    for (let year = 1; year <= maxYear; year++) {
        body.push(row(`Year ${year}`, pkgs.map(p => {
            // Shorter schedule → the package's "thereafter" rate is what applies that
            // year, so show it instead of a blank (mirrors RateCompareModal).
            const e = p.rate_schedule.find(x => !x.thereafter && x.year === year)
                ?? p.rate_schedule.find(x => x.thereafter)
            if (!e) return '<span style="color:#cbd5e1;">—</span>'
            const eff = e.type === 'floating' ? effectiveRate(e, sora).rate : (e.rate ?? null)
            return `${esc(rateText(e))}${eff != null ? ` <span style="color:#0277a8;">(${eff.toFixed(2)}%)</span>` : ''}`
        })))
    }
    if (anyThereafter) {
        body.push(row('Thereafter', pkgs.map(p => {
            const e = p.rate_schedule.find(x => x.thereafter)
            if (!e) return '<span style="color:#cbd5e1;">—</span>'
            const eff = e.type === 'floating' ? effectiveRate(e, sora).rate : (e.rate ?? null)
            return `${esc(rateText(e))}${eff != null ? ` <span style="color:#0277a8;">(${eff.toFixed(2)}%)</span>` : ''}`
        })))
    }

    // Estimated monthly repayments.
    if (priced) {
        body.push(sepRow(`Estimated monthly · ${money(loan!)} over ${tenureYears} yrs`))
        const y1Monthly = projections.map(pr => pr?.perYear[0]?.installment ?? null)
        body.push(row('Year 1', y1Monthly.map(m => (m != null ? money(m) : 'Not priced')), lowestIndex(y1Monthly)))
        const avg = projections.map(pr => pr?.newMonthly ?? null)
        body.push(row('Avg over lock-in', avg.map(m => (m != null ? money(m) : '—')), lowestIndex(avg)))
    }

    // Features + subsidies.
    if (pkgs.some(p => p.features.length)) {
        body.push(sepRow('Features'))
        body.push(row('', pkgs.map(p => (p.features.length
            ? `<ul style="margin:0;padding-left:16px;">${p.features.map(f => `<li style="margin:2px 0;">${esc(f)}</li>`).join('')}</ul>`
            : '<span style="color:#cbd5e1;">—</span>'))))
    }
    if (pkgs.some(p => p.subsidies)) {
        body.push(row('Subsidy', pkgs.map(p => (p.subsidies ? esc(p.subsidies) : '<span style="color:#cbd5e1;">—</span>'))))
    }

    const table = `<table style="width:100%;border-collapse:collapse;table-layout:fixed;">${body.join('')}</table>`

    const coverStats: CoverStat[] = [
        { label: 'Loan amount', value: loan != null ? money(loan) : '' },
        { label: 'Tenure', value: tenureYears != null ? `${tenureYears} years` : '' },
        { label: 'Packages', value: `${n} compared` },
        { label: 'SORA as of', value: sora ? (sora.published_date ?? sora.value_date ?? '') : '' },
    ]

    return renderPresentation({
        planLabel: 'Package Comparison',
        docTitle: 'Mortgage Package Comparison',
        heading: d.clientName ? `Prepared for ${d.clientName}` : 'Mortgage package comparison',
        advisorName: d.advisorName,
        coverStats,
        bodyHtml: section(
            'Side-by-side comparison',
            'The packages selected for you, compared on the terms that matter — rates shown at today’s SORA.',
            table,
        ),
        disclaimer: 'All rates and figures are estimates for discussion purposes only and are subject to each bank’s formal assessment and approval. Floating rates are computed from the latest published SORA and will change over time. This comparison does not constitute a formal offer of credit.',
        autoPrint: d.autoPrint,
    })
}
