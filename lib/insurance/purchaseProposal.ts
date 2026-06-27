/**
 * Build a clean, client-shareable proposal summary from a New Purchase
 * computation + the agent's selected package. Plain text, WhatsApp-friendly.
 */

import type { PurchaseComputation, OptionResult } from '@/lib/insurance/purchaseCalc'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import type { RateScheduleEntry } from '@/lib/types/rates'

export interface ProposalPackage {
    bank?: string
    package_name?: string
    category?: string
    lockin_years?: number
    year1_rate?: number | null
    projected_monthly?: number | null
    rate_schedule?: RateScheduleEntry[]
    features?: string[]
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct = (frac: number) => {
    const v = frac * 100
    return Number.isInteger(v) ? `${v}%` : `${v.toFixed(2)}%`
}

function optionBlock(opt: OptionResult): string {
    const lines = [
        `OPTION ${opt.key} — up to ${pct(opt.ltvPct)} LTV (tenure to age ${opt.ageCap})`,
        `• Loan: ${money(opt.finalLoan)} over ${opt.tenure} years`,
        `• Est. monthly instalment: ${money(opt.installment)}`,
        `• Min cash: ${money(opt.minCashDown)}  |  Cash/CPF: ${money(opt.cashCpfDown)}`,
    ]
    if (opt.pledge) {
        lines.push(`• To reach full ${pct(opt.ltvPct)}: pledge ${money(opt.pledge.pledgeFund)} or show ${money(opt.pledge.showFund)} in funds`)
    }
    return lines.join('\n')
}

export function buildProposalText(args: {
    clientName?: string
    propertyLabel: string
    price: number
    computation: PurchaseComputation
    selectedPackage?: ProposalPackage | null
}): string {
    const { clientName, propertyLabel, price, computation, selectedPackage } = args
    const parts: string[] = []

    parts.push(`Hi${clientName ? ` ${clientName}` : ''}, here's your home loan summary 👇`)
    parts.push(`Property: ${propertyLabel} · Price: ${money(price)}`)

    parts.push(computation.options.map(optionBlock).join('\n\n'))

    const fees = [
        `• Buyer's Stamp Duty: ${money(computation.bsd)}`,
        `• ABSD${computation.absdRatePct ? ` (${computation.absdRatePct % 1 === 0 ? computation.absdRatePct : computation.absdRatePct.toFixed(1)}%)` : ''}: ${money(computation.absd)}`,
        `• Legal fee (est.): ${money(computation.legalFee)}`,
        `• Valuation fee (est.): ${money(computation.valuationFee)}`,
    ]
    parts.push(`UPFRONT COSTS\n${fees.join('\n')}`)

    if (selectedPackage?.bank) {
        const pkgLines = [
            `RECOMMENDED PACKAGE`,
            `${selectedPackage.bank}${selectedPackage.category ? ` · ${selectedPackage.category}` : ''}${selectedPackage.lockin_years ? ` · ${selectedPackage.lockin_years}Y lock-in` : ' · No lock-in'}`,
        ]
        if (selectedPackage.package_name) pkgLines.push(selectedPackage.package_name)
        if (selectedPackage.rate_schedule?.length) {
            pkgLines.push(...formatRateSchedule(selectedPackage.rate_schedule).map(l => `• ${l}`))
        } else if (selectedPackage.year1_rate != null) {
            pkgLines.push(`• Year 1: ${selectedPackage.year1_rate.toFixed(2)}%`)
        }
        if (selectedPackage.projected_monthly != null) {
            pkgLines.push(`• Est. monthly: ${money(selectedPackage.projected_monthly)}`)
        }
        parts.push(pkgLines.join('\n'))
    }

    parts.push('Figures are estimates for guidance only and subject to bank approval. Let me know if you\'d like to proceed or have any questions!')

    return parts.join('\n\n')
}
