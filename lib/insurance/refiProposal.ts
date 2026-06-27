/**
 * Client-shareable refinancing summary (plain text, WhatsApp-friendly) — the
 * secondary "send it over" output. The primary deliverable is the on-screen
 * presentation (RefiPresentation.tsx).
 */

import type { RefiComputation } from '@/lib/insurance/refiCalc'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import type { RateScheduleEntry } from '@/lib/types/rates'

export interface RefiProposalPackage {
    bank?: string
    package_name?: string
    category?: string
    lockin_years?: number
    year1_rate?: number | null
    projected_monthly?: number | null
    current_monthly?: number | null
    monthly_saving?: number | null
    net_saving_2yr?: number | null
    rate_schedule?: RateScheduleEntry[]
    features?: string[]
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

export function buildRefiProposalText(args: {
    clientName?: string
    propertyLabel: string
    currentBank?: string
    totalOutstanding: number
    currentRatePct?: number
    computation: RefiComputation
    selectedPackage?: RefiProposalPackage | null
}): string {
    const { clientName, propertyLabel, currentBank, totalOutstanding, currentRatePct, computation, selectedPackage } = args
    const parts: string[] = []

    parts.push(`Hi${clientName ? ` ${clientName}` : ''}, here's your refinancing summary 👇`)
    const head = [`Property: ${propertyLabel}`, `Outstanding: ${money(totalOutstanding)}`]
    if (currentBank) head.push(`Current bank: ${currentBank}`)
    if (currentRatePct) head.push(`Current rate: ${currentRatePct}%`)
    parts.push(head.join('\n'))

    if (computation.tenure && !computation.tenure.error) {
        parts.push(`TENURE RANGE\n• ${computation.tenure.min} to ${computation.tenure.max} years`)
    }

    if (selectedPackage?.bank) {
        const lines = [
            'RECOMMENDED PACKAGE',
            `${selectedPackage.bank}${selectedPackage.category ? ` · ${selectedPackage.category}` : ''}${selectedPackage.lockin_years ? ` · ${selectedPackage.lockin_years}Y lock-in` : ' · No lock-in'}`,
        ]
        if (selectedPackage.package_name) lines.push(selectedPackage.package_name)
        if (selectedPackage.rate_schedule?.length) lines.push(...formatRateSchedule(selectedPackage.rate_schedule).map(l => `• ${l}`))
        else if (selectedPackage.year1_rate != null) lines.push(`• Year 1: ${selectedPackage.year1_rate.toFixed(2)}%`)
        if (selectedPackage.projected_monthly != null) lines.push(`• New monthly: ${money(selectedPackage.projected_monthly)}`)
        if (selectedPackage.monthly_saving != null && selectedPackage.monthly_saving > 0) {
            lines.push(`• Est. monthly saving: ${money(selectedPackage.monthly_saving)}`)
            if (selectedPackage.net_saving_2yr != null) lines.push(`• Est. 2-year net saving: ${money(selectedPackage.net_saving_2yr)}`)
        }
        parts.push(lines.join('\n'))
    }

    if (computation.cost) {
        const cost = computation.cost
        const lines = ['COST OF REFINANCING', `• Legal fee: ${money(cost.legalFee)} ${cost.legalNote}`, `• Valuation fee: ${cost.valuationDisplay}`]
        if (cost.estSubsidy != null) lines.push(`• Estimated subsidy: ${cost.estSubsidy > 0 ? `${money(cost.estSubsidy)} cash` : '$0'}`)
        parts.push(lines.join('\n'))
    }

    if (computation.cancellationFee > 0) {
        parts.push(`Note: est. cancellation fee on the undisbursed amount ≈ ${money(computation.cancellationFee)}.`)
    }

    parts.push('Figures are estimates for guidance only and subject to the bank\'s assessment and approval. Let me know if you\'d like to proceed!')
    return parts.join('\n\n')
}
