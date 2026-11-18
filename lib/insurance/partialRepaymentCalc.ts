import { monthlyInstallment } from '@/lib/insurance/loanCalc'
import { getRateForYear } from '@/lib/insurance/amortCalc'
import { type RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'

/**
 * Partial (lump-sum) repayment amortisation, month by month.
 *
 * Same rate-schedule + SORA resolution as the Amortization calculator (rates
 * are still set per YEAR — month m falls in year ceil(m/12)). A prepayment
 * scheduled `afterMonth: N` is applied entering month N+1, before that month's
 * interest accrues (so "after month 12" ≡ the old "after year 1" → hits month
 * 13). The loan is then re-amortised over the REMAINING months (tenure
 * unchanged) so the monthly instalment drops — matching how the bank
 * repayment sheets behave ("reduce instalment" mode).
 */

export interface Prepayment {
    afterMonth: number  // lump sum applied at the start of the following month
    amount: number      // SGD
}

export interface PartialRepaymentRow {
    month: number               // 1-based, across the whole tenure
    year: number                // year this month falls in (1-based)
    rate: number | null
    instalment: number | null   // monthly instalment in force this month
    prepayment: number          // lump sum applied at the start of this month (0 if none)
    principal: number | null
    interest: number | null
    balance: number | null      // outstanding at month end
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
    const totalMonths = tenure * 12
    let balance = loanAmount
    let cumulativeInterest = 0
    let instalment = 0
    let prevRate: number | null = null

    // Sum prepayments per "applied-at" month (afterMonth N → applied entering month N+1).
    const prepayByMonth = new Map<number, number>()
    for (const p of prepayments) {
        if (!p.amount || p.amount <= 0) continue
        const applyMonth = p.afterMonth + 1
        prepayByMonth.set(applyMonth, (prepayByMonth.get(applyMonth) ?? 0) + p.amount)
    }

    for (let month = 1; month <= totalMonths; month++) {
        const year = Math.ceil(month / 12)
        const rate = getRateForYear(year, schedule, sora)

        // Apply any lump sum at the start of the month, before interest accrues.
        const prepayment = prepayByMonth.get(month) ?? 0
        if (prepayment > 0 && balance > 0) {
            balance = Math.max(balance - prepayment, 0)
        }

        if (rate === null || balance <= 0) {
            const paidOff = balance <= 0
            rows.push({
                month, year, rate: null, instalment: null,
                prepayment,
                principal: null, interest: null,
                balance: paidOff ? 0 : null,
                cumulativeInterest: paidOff ? cumulativeInterest : null,
            })
            prevRate = null
            continue
        }

        // Re-amortise over the remaining months when the rate changes OR a lump
        // sum was just applied (reduce-instalment: tenure stays the same).
        const remainingMonths = totalMonths - month + 1
        if (rate !== prevRate || prepayment > 0 || instalment === 0) {
            instalment = monthlyInstallment(balance, rate, remainingMonths / 12)
        }
        prevRate = rate

        const interest = balance * (rate / 100 / 12)
        const principal = Math.min(instalment - interest, balance)
        balance = Math.max(balance - principal, 0)
        cumulativeInterest += interest

        rows.push({
            month, year, rate, instalment,
            prepayment,
            principal,
            interest,
            balance,
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

    const totalMonths = tenure * 12
    const cleaned = prepayments.filter(p => p.amount > 0 && p.afterMonth >= 1 && p.afterMonth < totalMonths)
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
