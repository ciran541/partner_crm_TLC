import { monthlyInstallment } from '@/lib/insurance/loanCalc'
import { getRateForYear } from '@/lib/insurance/amortCalc'
import { type RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'

/**
 * Partial (lump-sum) repayment amortisation.
 *
 * Same rate-schedule + SORA resolution as the Amortization calculator, but
 * month-aware so lump sums can be applied mid-loan. A prepayment scheduled
 * `afterYear: N` is applied entering the first month of year N+1 (e.g.
 * "after Year 1" hits month 13), then the loan is re-amortised over the
 * REMAINING tenure (unchanged) so the monthly instalment drops — matching how
 * the bank repayment sheets behave ("reduce instalment" mode).
 */

export interface Prepayment {
    afterYear: number   // lump sum applied at the start of the following year
    amount: number      // SGD
}

export interface PartialRepaymentRow {
    year: number
    rate: number | null
    instalment: number | null   // monthly instalment in force during the year (after any re-amortisation)
    prepayment: number          // lump sum applied at the start of this year (0 if none)
    yearPrincipal: number | null
    yearInterest: number | null
    balance: number | null      // outstanding at year end
    cumulativeInterest: number | null
}

export interface PartialRepaymentResult {
    rows: PartialRepaymentRow[]
    totalInterest: number | null        // with prepayments
    baselineInterest: number | null     // without any prepayments
    interestSaved: number | null        // baseline − with prepayments
    totalPrepaid: number
}

/** Internal single pass over the loan. `prepayments` may be empty (baseline). */
function runSchedule(
    loanAmount: number,
    tenure: number,
    schedule: RateScheduleEntry[],
    sora: SoraRates | null,
    prepayments: Prepayment[],
): { rows: PartialRepaymentRow[]; totalInterest: number | null } {
    const rows: PartialRepaymentRow[] = []
    let balance = loanAmount
    let cumulativeInterest = 0
    let instalment = 0
    let prevRate: number | null = null

    // Sum prepayments per "applied-at" year (afterYear N → applied entering year N+1).
    const prepayByYear = new Map<number, number>()
    for (const p of prepayments) {
        if (!p.amount || p.amount <= 0) continue
        const applyYear = p.afterYear + 1
        prepayByYear.set(applyYear, (prepayByYear.get(applyYear) ?? 0) + p.amount)
    }

    for (let year = 1; year <= tenure; year++) {
        const rate = getRateForYear(year, schedule, sora)

        // Apply any lump sum at the start of the year, before interest accrues.
        const prepayment = prepayByYear.get(year) ?? 0
        if (prepayment > 0 && balance > 0) {
            balance = Math.max(balance - prepayment, 0)
        }

        if (rate === null || balance <= 0) {
            const paidOff = balance <= 0
            rows.push({
                year, rate: null, instalment: null,
                prepayment,
                yearPrincipal: null, yearInterest: null,
                balance: paidOff ? 0 : null,
                cumulativeInterest: paidOff ? cumulativeInterest : null,
            })
            prevRate = null
            continue
        }

        // Re-amortise over the remaining tenure when the rate changes OR a lump
        // sum was just applied (reduce-instalment: tenure stays the same).
        const remainingTenure = tenure - year + 1
        if (rate !== prevRate || prepayment > 0 || instalment === 0) {
            instalment = monthlyInstallment(balance, rate, remainingTenure)
        }
        prevRate = rate

        const r = rate / 100 / 12
        let yearPrincipal = 0
        let yearInterest = 0

        for (let m = 1; m <= 12; m++) {
            if (balance <= 0) break
            const interest = balance * r
            const principal = Math.min(instalment - interest, balance)
            yearPrincipal += principal
            yearInterest += interest
            balance = Math.max(balance - principal, 0)
        }

        cumulativeInterest += yearInterest
        rows.push({
            year, rate, instalment,
            prepayment,
            yearPrincipal,
            yearInterest,
            balance: Math.max(balance, 0),
            cumulativeInterest,
        })
    }

    const valid = rows.filter(r => r.cumulativeInterest != null)
    return { rows, totalInterest: valid.at(-1)?.cumulativeInterest ?? null }
}

export function computePartialRepayment(
    loanAmount: number,
    tenure: number,
    schedule: RateScheduleEntry[],
    sora: SoraRates | null,
    prepayments: Prepayment[],
): PartialRepaymentResult {
    if (!loanAmount || loanAmount <= 0 || !tenure || tenure <= 0) {
        return { rows: [], totalInterest: null, baselineInterest: null, interestSaved: null, totalPrepaid: 0 }
    }

    const cleaned = prepayments.filter(p => p.amount > 0 && p.afterYear >= 1 && p.afterYear < tenure)
    const withPrepay = runSchedule(loanAmount, tenure, schedule, sora, cleaned)
    const baseline = cleaned.length > 0
        ? runSchedule(loanAmount, tenure, schedule, sora, [])
        : withPrepay

    const totalInterest = withPrepay.totalInterest
    const baselineInterest = baseline.totalInterest
    const interestSaved = totalInterest != null && baselineInterest != null
        ? baselineInterest - totalInterest
        : null

    return {
        rows: withPrepay.rows,
        totalInterest,
        baselineInterest,
        interestSaved,
        totalPrepaid: cleaned.reduce((s, p) => s + p.amount, 0),
    }
}
