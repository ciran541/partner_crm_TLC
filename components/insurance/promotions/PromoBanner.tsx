'use client'

import { useState } from 'react'
import { Gift, Clock, ChevronDown, Users, AlertTriangle, CalendarClock } from 'lucide-react'
import { WINDOW_BASIS_LABELS } from '@/lib/types/promotions'
import type { MatchedPromotion } from '@/lib/insurance/promotions'

const fmtDate = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "Submit by 16 Aug · 6 days left" — the deadline an agent actually acts on. */
function Deadline({ m }: { m: MatchedPromotion }) {
    const { promo, daysLeft, upcoming } = m
    if (upcoming && promo.starts_on) {
        return <>Opens {fmtDate(promo.starts_on)}</>
    }
    if (!promo.ends_on) return <>No closing date given</>
    const basis = WINDOW_BASIS_LABELS[promo.window_basis] ?? 'Ends'
    const left = daysLeft == null ? null
        : daysLeft === 0 ? 'closes today'
        : daysLeft === 1 ? '1 day left'
        : `${daysLeft} days left`
    return <>{basis} {fmtDate(promo.ends_on)}{left ? ` · ${left}` : ''}</>
}

function PromoRow({ m }: { m: MatchedPromotion }) {
    const [open, setOpen] = useState(false)
    const { promo, label, endingSoon } = m
    const agentOnly = promo.audience === 'agent'
    const hasDetail = promo.conditions.length > 0 || promo.affects_ltv || promo.clawback_years != null

    return (
        <div className="rounded-lg border border-amber-200/70 bg-white/70">
            <div className="flex items-start gap-2.5 p-2.5">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md shrink-0 ${agentOnly ? 'bg-violet-100' : 'bg-amber-100'}`}>
                    {agentOnly ? <Users size={13} className="text-violet-600" /> : <Gift size={13} className="text-amber-600" />}
                </span>
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[#052d4a] leading-snug">
                        {promo.bank} · {promo.title}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                        <span className={`text-[11px] font-bold ${agentOnly ? 'text-violet-700' : 'text-amber-700'}`}>{label}</span>
                        <span className={`inline-flex items-center gap-1 text-[11px] ${endingSoon ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>
                            <Clock size={10} /><Deadline m={m} />
                        </span>
                        {agentOnly && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                                Agent only — not shown to clients
                            </span>
                        )}
                        {promo.applies_to.length > 0 && (
                            <span className="text-[10px] text-slate-400">{promo.applies_to.join(' · ')}</span>
                        )}
                    </div>
                </div>
                {hasDetail && (
                    <button type="button" onClick={() => setOpen(!open)}
                        className="shrink-0 p-1 text-slate-400 hover:text-amber-700 rounded-md" title={open ? 'Hide conditions' : 'Show conditions'}>
                        <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
                    </button>
                )}
            </div>

            {open && hasDetail && (
                <div className="px-2.5 pb-2.5 pt-0 space-y-2">
                    {/* Flagged, not silently applied — this changes the max-loan math. */}
                    {promo.affects_ltv && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-start gap-1.5">
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                            The rebate is netted off the purchase price for LTV. The calculator does <strong>not</strong> apply this automatically — adjust the loan figure yourself.
                        </p>
                    )}
                    {promo.clawback_years != null && (
                        <p className="text-[11px] text-slate-600 flex items-start gap-1.5">
                            <CalendarClock size={11} className="mt-0.5 shrink-0 text-slate-400" />
                            {promo.clawback_years}-year clawback — flag this if the client refinances again before then.
                        </p>
                    )}
                    {promo.conditions.length > 0 && (
                        <ul className="space-y-0.5">
                            {promo.conditions.map((c, i) => (
                                <li key={i} className="text-[11px] text-slate-600 flex gap-1.5">
                                    <span className="text-amber-400 shrink-0">•</span>{c}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    )
}

/**
 * The promotions strip — used on the dashboard and above the Rates page list.
 *
 * Renders nothing at all when there is nothing running, so it never occupies
 * space as an empty shell on the app's busiest screens.
 */
export default function PromoBanner({
    promotions,
    heading = 'Bank promotions running now',
}: {
    promotions: MatchedPromotion[]
    heading?: string
}) {
    if (!promotions.length) return null

    return (
        <div className="rounded-xl border border-amber-200 bg-gradient-to-b from-amber-50 to-amber-50/40 overflow-hidden">
            <div className="px-3.5 py-2.5 flex items-center gap-2 border-b border-amber-200/70">
                <Gift size={15} className="text-amber-600 shrink-0" />
                <p className="text-[13px] font-bold text-amber-900">{heading}</p>
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                    {promotions.length}
                </span>
            </div>
            <div className="p-2.5 space-y-2">
                {promotions.map(m => <PromoRow key={m.promo.id} m={m} />)}
            </div>
        </div>
    )
}
