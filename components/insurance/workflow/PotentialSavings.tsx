'use client'

import { PiggyBank, ArrowRight } from 'lucide-react'

/**
 * "Potential Savings" — the simple headline number agents quote a client:
 *
 *     (current rate − new package's year-1 rate) × (outstanding home loan + equity loan) = savings p.a.
 *
 * Deliberately simple interest on today's outstanding balance — NOT the
 * amortised / net-of-fees saving that RefiPackages' "Save $X" badges show.
 * Shared by the Refinancing and Equity Loan workflows (both refinance the
 * existing HL + EL at the chosen bank). Decoupling is excluded: its new loan
 * is the buyer's share, not the full outstanding balance.
 */
interface Props {
    currentRatePct: number | null | undefined
    /** Year-1 rate of the selected package; null/undefined = no package picked yet. */
    newRatePct: number | null | undefined
    newBank?: string | null
    homeLoan: number
    equityLoan: number
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-SG')}`
const pct = (n: number) => `${n.toFixed(2)}%`

export default function PotentialSavings({ currentRatePct, newRatePct, newBank, homeLoan, equityLoan }: Props) {
    const total = homeLoan + equityLoan
    // Nothing to compare against without a current rate and a balance.
    if (currentRatePct == null || total <= 0) return null

    return (
        <div className="card p-5 space-y-4">
            <div>
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <span className="text-[#03a9e7]"><PiggyBank size={15} /></span>Potential Savings
                </p>
                <p className="text-[12px] text-slate-400 mt-0.5">Based on current total outstanding loan amount</p>
            </div>

            {newRatePct == null ? (
                <p className="text-[13px] text-slate-500">Select a package above to see the potential savings against the current rate.</p>
            ) : (() => {
                const diff = currentRatePct - newRatePct
                const savings = (diff / 100) * total
                const saves = savings > 0

                return (
                    <>
                        <div className="flex flex-wrap items-end justify-between gap-4">
                            <div>
                                {saves ? (
                                    <>
                                        <p className="text-3xl font-bold text-emerald-600 tabular-nums leading-none">
                                            {money(savings)}<span className="text-base font-semibold text-emerald-600/80"> p.a.</span>
                                        </p>
                                        <p className="text-[12px] text-slate-400 mt-1.5">≈ {money(savings / 12)} / month</p>
                                    </>
                                ) : (
                                    <p className="text-[15px] font-semibold text-amber-600">
                                        No savings — the new rate isn&apos;t lower than the current rate.
                                    </p>
                                )}
                            </div>

                            <div className="flex items-center gap-3 text-sm">
                                <div className="text-right">
                                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Current</p>
                                    <p className="font-semibold text-slate-700 tabular-nums">{pct(currentRatePct)}</p>
                                </div>
                                <ArrowRight size={15} className="text-slate-300" />
                                <div>
                                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{newBank ? `${newBank} · Yr 1` : 'New · Yr 1'}</p>
                                    <p className="font-semibold text-[#03a9e7] tabular-nums">{pct(newRatePct)}</p>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] text-slate-500 tabular-nums">
                            ({pct(currentRatePct)} − {pct(newRatePct)}) × {money(total)}
                            {equityLoan > 0 && homeLoan > 0 && (
                                <span className="text-slate-400"> (HL {money(homeLoan)} + EL {money(equityLoan)})</span>
                            )}
                            {' '}= <span className="font-semibold text-slate-700">{money(savings)} p.a.</span>
                        </div>
                    </>
                )
            })()}
        </div>
    )
}
