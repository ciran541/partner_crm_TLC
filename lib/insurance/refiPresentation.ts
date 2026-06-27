/**
 * Refinancing client document. Composes the shared presentation engine
 * (presentationShell.ts) so the on-screen modal, the printed page, and the emailed
 * PDF are all the same HTML — and stay in step with the workflow.
 */

import type { RefiComputation } from '@/lib/insurance/refiCalc'
import type { RefiRemarks } from '@/lib/insurance/refiRemarks'
import type { RefiProposalPackage } from '@/lib/insurance/refiProposal'
import type { SoraRates } from '@/lib/insurance/sora'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import { packageStyle } from '@/lib/insurance/rateFilters'
import { computeAmortization } from '@/lib/insurance/amortCalc'
import {
    renderPresentation, section, packageCard, instalmentBreakdown, kvTable, notesBlock,
    money, type CoverStat,
} from '@/lib/insurance/presentationShell'

export interface RefiPresentationData {
    clientName?: string
    advisorName?: string
    propertyLabel: string
    currentBank?: string
    currentRatePct?: number
    totalOutstanding: number
    computation: RefiComputation
    remarks: RefiRemarks
    selectedPackage?: RefiProposalPackage | null
    sora?: SoraRates | null
    autoPrint?: boolean
}

export function buildRefiPresentationHtml(d: RefiPresentationData): string {
    const c = d.computation
    const sections: string[] = []
    const tenure = c.tenure && !c.tenure.error ? c.tenure.max : undefined

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
            'The package best matched to your loan — with the savings versus your current rate.',
            packageCard({
                bank: pkg.bank, package_name: pkg.package_name, category: pkg.category, lockin_years: pkg.lockin_years,
                scheduleLines, style, features: pkg.features,
                current_monthly: pkg.current_monthly, projected_monthly: pkg.projected_monthly,
                monthly_saving: pkg.monthly_saving, net_saving_2yr: pkg.net_saving_2yr,
            }),
        ))

        // Monthly instalment & interest breakdown
        if (tenure && pkg.rate_schedule?.length) {
            const rows = computeAmortization(d.totalOutstanding, tenure, pkg.rate_schedule, d.sora ?? null)
            const breakdown = instalmentBreakdown({ rows, lockinYears: pkg.lockin_years, monthly: pkg.projected_monthly, tenureYears: tenure })
            if (breakdown) {
                sections.push(section(
                    'Monthly instalment & interest',
                    'Your estimated instalment and the interest you’d pay during the lock-in.',
                    breakdown,
                ))
            }
        }
    }

    // Tenure range
    if (c.tenure && !c.tenure.error) {
        sections.push(section(
            'Refinancing tenure range',
            'The loan term we can structure for you across the banks.',
            `<div class="inst-hero"><b>${c.tenure.min} – ${c.tenure.max} years</b>` +
            `<span>Based on ${c.usingIwaa ? 'income-weighted average age' : 'average age'}` +
            `${c.ageForTenure != null ? ` ${Math.ceil(c.ageForTenure)}` : ''}</span></div>`,
        ))
    }

    // Cost of refinancing
    if (d.remarks.cost.length) {
        const rows = d.remarks.cost.map(line => {
            const [label, ...rest] = line.split(':')
            return { label: label.trim(), value: rest.join(':').trim() }
        })
        sections.push(section(
            'Cost of refinancing',
            'One-time costs to switch — separate from your monthly instalment.',
            kvTable(rows),
        ))
    }

    // Key things to note
    const notes = [...d.remarks.standard, ...d.remarks.conditional]
    if (d.remarks.alerts.length || notes.length) {
        sections.push(section('Key things to note', undefined, notesBlock(d.remarks.alerts, notes)))
    }

    const coverStats: CoverStat[] = [
        { label: 'Property', value: d.propertyLabel },
        { label: 'Outstanding', value: money(d.totalOutstanding) },
        ...(d.currentBank ? [{ label: 'Current bank', value: d.currentBank }] : []),
        ...(d.currentRatePct ? [{ label: 'Current rate', value: `${d.currentRatePct}%` }] : []),
    ]

    return renderPresentation({
        planLabel: 'Refinancing Plan',
        docTitle: `Refinancing Plan${d.clientName ? ` — ${d.clientName}` : ''}`,
        heading: d.clientName ? `Prepared for ${d.clientName}` : 'Your refinancing summary',
        advisorName: d.advisorName,
        coverStats,
        bodyHtml: sections.join('\n'),
        disclaimer: 'All figures are estimates for discussion only and are subject to the bank’s formal assessment and approval. Savings compare your current rate against the recommended package over the same outstanding loan and tenure.',
        autoPrint: d.autoPrint,
    })
}
