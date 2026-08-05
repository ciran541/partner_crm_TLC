'use client'

import { Gift, Clock, Users } from 'lucide-react'
import type { MatchedPromotion } from '@/lib/insurance/promotions'

/**
 * The promotion pill shown on a package card (Step 4) or a rates row.
 *
 * Agent-only incentives are drawn deliberately differently — violet with a
 * people icon, never the amber "client gets money" treatment. These screens get
 * turned toward a client mid-conversation, so an agent's referral fee has to be
 * visually unmistakable rather than just correctly labelled.
 */
export default function PromoBadge({ matched, compact = false }: { matched: MatchedPromotion; compact?: boolean }) {
    const { promo, label, daysLeft, endingSoon, upcoming } = matched
    const agentOnly = promo.audience === 'agent'

    const tone = agentOnly
        ? 'bg-violet-50 text-violet-700 border-violet-200'
        : endingSoon
            ? 'bg-amber-100 text-amber-800 border-amber-300'
            : 'bg-amber-50 text-amber-700 border-amber-200'

    const timing = upcoming ? 'soon'
        : daysLeft == null ? null
        : daysLeft === 0 ? 'today'
        : daysLeft === 1 ? '1d left'
        : `${daysLeft}d left`

    return (
        <span
            title={`${promo.bank} · ${promo.title}${timing ? ` · ${timing}` : ''}${agentOnly ? ' · agent-only, not shown to clients' : ''}`}
            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap ${tone}`}
        >
            {agentOnly ? <Users size={10} className="shrink-0" /> : <Gift size={10} className="shrink-0" />}
            {label}
            {!compact && timing && (
                <span className="inline-flex items-center gap-0.5 font-medium opacity-80">
                    <Clock size={9} className="shrink-0" />{timing}
                </span>
            )}
        </span>
    )
}
