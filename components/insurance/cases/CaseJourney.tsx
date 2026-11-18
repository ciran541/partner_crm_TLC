'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { History, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { stageBadge } from '@/lib/insurance/stages'
import { closingBank } from '@/lib/insurance/revisit'
import type { Case } from '@/lib/types'

/**
 * Client journey — every case in this client's chain (linked by parent_case_id
 * through Revisit), oldest first: e.g. 2025 Refinancing · Closed Won with DBS
 * → 2027 Refinancing · Touched Base. Renders nothing for a case with no links.
 *
 * Reads with the signed-in user's session, so RLS decides what's visible (an
 * agent sees their own cases; an admin sees all).
 */

type JourneyCase = Pick<Case, 'id' | 'stage' | 'case_type' | 'created_at' | 'parent_case_id' | 'closed_won_data' | 'referred_bankers' | 'existing_loan_amount' | 'loan_size' | 'closed_package_details'>

const COLS = 'id, stage, case_type, created_at, parent_case_id, closed_won_data, referred_bankers, existing_loan_amount, loan_size, closed_package_details'
const MAX_HOPS = 20

const money = (n?: number | null) => (n && n > 0 ? `$${Math.round(n).toLocaleString('en-SG')}` : null)
const fmtDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
    .toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' })

export default function CaseJourney({ caseId, parentId, hrefFor }: {
    caseId: string
    parentId?: string | null
    /** Link target for a case in the chain (agent vs admin pages). */
    hrefFor: (id: string) => string
}) {
    const [chain, setChain] = useState<JourneyCase[] | null>(null)

    useEffect(() => {
        let alive = true
        ;(async () => {
            const fetchOne = async (q: { id?: string; parent?: string }) => {
                const base = supabase.from('cases').select(COLS)
                const { data } = q.id ? await base.eq('id', q.id).maybeSingle() : await base.eq('parent_case_id', q.parent!).maybeSingle()
                return (data ?? null) as JourneyCase | null
            }
            const self = await fetchOne({ id: caseId })
            if (!self) return
            const before: JourneyCase[] = []
            for (let p = parentId ?? self.parent_case_id, i = 0; p && i < MAX_HOPS; i++) {
                const c = await fetchOne({ id: p })
                if (!c) break
                before.unshift(c)
                p = c.parent_case_id
            }
            const after: JourneyCase[] = []
            for (let cur = caseId, i = 0; i < MAX_HOPS; i++) {
                const c = await fetchOne({ parent: cur })
                if (!c) break
                after.push(c)
                cur = c.id
            }
            if (alive) setChain([...before, self, ...after])
        })()
        return () => { alive = false }
    }, [caseId, parentId])

    if (!chain || chain.length < 2) return null

    return (
        <div className="card p-5">
            <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center"><History size={16} className="text-[#03a9e7]" /></div>
                <div>
                    <p className="text-sm font-bold text-[#052d4a]">Client journey</p>
                    <p className="text-[11px] text-slate-400">{chain.length} cases with this client, oldest first</p>
                </div>
            </div>
            <ol className="relative border-l-2 border-slate-100 ml-3 space-y-4">
                {chain.map((c, i) => {
                    const isSelf = c.id === caseId
                    const cw = c.closed_won_data ?? {}
                    const badge = stageBadge(c.stage)
                    const bank = c.stage === 'Closed Won' ? closingBank(c) : undefined
                    const loan = c.stage === 'Closed Won' ? money(cw.original_loan_total) : money(c.existing_loan_amount ?? c.loan_size)
                    const when = c.stage === 'Closed Won' && cw.closed_at ? `Closed ${fmtDate(cw.closed_at)}` : `Opened ${fmtDate(c.created_at)}`
                    return (
                        <li key={c.id} className="ml-5">
                            <span className={`absolute -left-[7px] mt-1.5 w-3 h-3 rounded-full border-2 border-white ${isSelf ? 'bg-[#03a9e7]' : 'bg-slate-300'}`} />
                            <div className={`rounded-xl border px-4 py-3 ${isSelf ? 'border-sky-200 bg-sky-50/40' : 'border-slate-100'}`}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cycle {i + 1}</span>
                                    <span className="text-sm font-semibold text-[#052d4a]">{c.case_type}</span>
                                    <span className="status-badge" style={{ color: badge.text, background: badge.bg }}>{c.stage}</span>
                                    {isSelf && <span className="text-[10px] font-bold text-[#03a9e7] bg-sky-100 px-1.5 py-0.5 rounded-full">This case</span>}
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    {[when, loan, bank && `with ${bank}`, c.stage === 'Closed Won' ? c.closed_package_details : null].filter(Boolean).join(' · ')}
                                </p>
                                {!isSelf && (
                                    <Link href={hrefFor(c.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#03a9e7] hover:underline mt-1.5">
                                        Open case <ArrowRight size={12} />
                                    </Link>
                                )}
                            </div>
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}
