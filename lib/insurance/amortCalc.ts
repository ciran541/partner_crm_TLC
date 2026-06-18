import { effectiveRate } from '@/lib/insurance/rateRecommend'
import { monthlyInstallment } from '@/lib/insurance/loanCalc'
import { type RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'

export interface AmortRow {
    year: number
    rate: number | null
    instalment: number | null
    monthPrincipal: number | null
    monthInterest: number | null
    yearPrincipal: number | null
    yearInterest: number | null
    balance: number | null
    cumulativeInterest: number | null
}

function resolveEntry(entry: RateScheduleEntry, sora: SoraRates | null): number | null {
    if (entry.type === 'floating' && (entry.reference ?? '').toLowerCase() === 'custom') {
        if (entry.rate == null) return null
        return entry.rate + (entry.spread ?? 0)
    }
    return effectiveRate(entry, sora).rate ?? null
}

export function getRateForYear(
    year: number,
    schedule: RateScheduleEntry[],
    sora: SoraRates | null,
): number | null {
    const yearEntry = schedule.find(e => e.year === year)
    if (yearEntry) return resolveEntry(yearEntry, sora)
    const thereafter = schedule.find(e => e.thereafter)
    if (thereafter) return resolveEntry(thereafter, sora)
    return null
}

export function computeAmortization(
    loanAmount: number,
    tenure: number,
    schedule: RateScheduleEntry[],
    sora: SoraRates | null,
): AmortRow[] {
    if (!loanAmount || loanAmount <= 0 || !tenure || tenure <= 0) return []
    const rows: AmortRow[] = []
    let balance = loanAmount
    let cumulativeInterest = 0

    for (let year = 1; year <= tenure; year++) {
        const rate = getRateForYear(year, schedule, sora)

        if (rate === null || balance <= 0) {
            rows.push({
                year, rate: null, instalment: null,
                monthPrincipal: null, monthInterest: null,
                yearPrincipal: null, yearInterest: null,
                balance: null, cumulativeInterest: null,
            })
            continue
        }

        const remainingTenure = tenure - year + 1
        const inst = monthlyInstallment(balance, rate, remainingTenure)
        const r = rate / 100 / 12

        let yearPrincipal = 0
        let yearInterest = 0
        let lastPrincipal = 0
        let lastInterest = 0

        for (let m = 1; m <= 12; m++) {
            const interest = balance * r
            const principal = Math.min(inst - interest, balance)
            yearPrincipal += principal
            yearInterest += interest
            balance = Math.max(balance - principal, 0)
            if (m === 12) { lastPrincipal = principal; lastInterest = interest }
        }

        cumulativeInterest += yearInterest
        rows.push({
            year, rate, instalment: inst,
            monthPrincipal: lastPrincipal,
            monthInterest: lastInterest,
            yearPrincipal,
            yearInterest,
            balance: Math.max(balance, 0),
            cumulativeInterest,
        })
    }
    return rows
}
