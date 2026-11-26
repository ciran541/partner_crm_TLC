import { AlertTriangle, Crown, Info } from 'lucide-react'
import { isExpired, restrictedTo, shortLoan } from '@/lib/insurance/rateFilters'
import { todaySgt } from '@/lib/insurance/promotions'
import type { MortgagePackage } from '@/lib/types/rates'

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })

/** Badges on every package card: who can take it, and whether the bank's end date has passed. */
export function PackageBadges({ pkg, showPriorityMin = true }: { pkg: MortgagePackage; showPriorityMin?: boolean }) {
    const who = restrictedTo(pkg)
    // One rate, two ways in: normal clients from the minimum, this bank's Priority clients from less.
    const pm = pkg.priority_min_loan != null && Number(pkg.priority_min_loan) < Number(pkg.min_loan_size) ? Number(pkg.priority_min_loan) : null
    return (
        <>
            {showPriorityMin && pm != null && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200"><Crown size={10} /> Priority from {shortLoan(pm)}</span>}
            {who && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200"><Crown size={10} /> {who}</span>}
            {isExpired(pkg, todaySgt()) && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    <AlertTriangle size={10} /> Valid until {day(pkg.valid_until!)}: check with banker
                </span>
            )}
        </>
    )
}

/** Lines in the expanded details. */
export function PackageDetailNotes({ pkg }: { pkg: MortgagePackage }) {
    const confirmed = pkg.confirmed_on ?? pkg.last_updated
    return (
        <div className="space-y-1">
            {pkg.bank_note && (
                <p className="text-[11px] text-sky-800 bg-sky-50 rounded-lg px-3 py-2 flex gap-1.5 whitespace-pre-line">
                    <Info size={12} className="mt-0.5 shrink-0" /> <span>{pkg.bank_note}</span>
                </p>
            )}
            <p className="text-[10px] text-slate-400">
                {confirmed ? `Last confirmed ${day(confirmed)}` : 'Not confirmed yet'}
                {pkg.valid_until && !isExpired(pkg, todaySgt()) ? ` · valid until ${day(pkg.valid_until)}` : ''}
            </p>
        </div>
    )
}
