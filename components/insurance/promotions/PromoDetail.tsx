'use client'

import { WINDOW_BASIS_LABELS } from '@/lib/types/promotions'
import type { MatchedPromotion } from '@/lib/insurance/promotions'

/**
 * The promotion block inside a package card's expanded "Details" panel —
 * shared by the refinancing and purchase package lists so the wording, the
 * agent-only treatment and the LTV caveat stay identical in both.
 */
export default function PromoDetail({ matched }: { matched: MatchedPromotion }) {
    const { promo, label, daysLeft } = matched
    const agentOnly = promo.audience === 'agent'

    return (
        <div className={`rounded-md border px-2 py-1.5 ${agentOnly ? 'border-violet-200 bg-violet-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
            <p className="font-semibold text-[10px] uppercase tracking-wide mb-0.5 text-slate-500">
                {agentOnly ? 'Agent incentive — internal' : `Promotion · ${promo.title}`}
            </p>
            <p className="text-[12px] font-semibold text-slate-700">{label}</p>
            {promo.ends_on && (
                <p className="text-[11px] text-slate-500">
                    {WINDOW_BASIS_LABELS[promo.window_basis]} {promo.ends_on}
                    {daysLeft != null && ` · ${daysLeft === 0 ? 'closes today' : `${daysLeft}d left`}`}
                </p>
            )}
            {promo.affects_ltv && (
                <p className="text-[11px] text-amber-800 mt-1">
                    Netted off the price for LTV — the calculator does not apply this automatically.
                </p>
            )}
            {promo.clawback_years != null && (
                <p className="text-[11px] text-slate-500 mt-0.5">{promo.clawback_years}-year clawback.</p>
            )}
            {promo.conditions.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                    {promo.conditions.map((c, i) => (
                        <li key={i} className="text-[11px] text-slate-500 flex gap-1"><span className="text-amber-400 shrink-0">›</span>{c}</li>
                    ))}
                </ul>
            )}
        </div>
    )
}
