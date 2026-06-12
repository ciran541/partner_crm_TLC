'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { CaseType } from '@/lib/types'
import { useCases, refreshCases } from '@/lib/insurance/useCases'
import { isDraftCase } from '@/lib/insurance/caseFilters'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import {
    RefreshCcw, ShoppingCart, Users, TrendingUp, ArrowRight,
    Clock, Trash2, FileText,
} from 'lucide-react'

const CASE_OPTIONS: {
    type: CaseType
    label: string
    icon: React.ElementType
    description: string
    accent: string
}[] = [
    { type: 'Purchase',    label: 'New Purchase', icon: ShoppingCart, description: 'Plan financing for a new property purchase', accent: '#03a9e7' },
    { type: 'Refinancing', label: 'Refinance',    icon: RefreshCcw,   description: 'Find a better rate on an existing loan', accent: '#10b981' },
    { type: 'Decouple',    label: 'Decoupling',   icon: Users,        description: 'Restructure ownership between co-owners', accent: '#8b5cf6' },
    { type: 'Equity Loan', label: 'Equity',       icon: TrendingUp,   description: 'Unlock cash from property equity', accent: '#f59e0b' },
]

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.round(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins} min ago`
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`
    const days = Math.round(hrs / 24)
    return `${days} day${days !== 1 ? 's' : ''} ago`
}

export default function MortgagePlannerPage() {
    const router = useRouter()
    const { cases } = useCases()
    const [userId, setUserId] = useState<string | null>(null)
    const [creating, setCreating] = useState<CaseType | null>(null)
    const [discardingId, setDiscardingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null))
    }, [])

    // The agent's own in-progress planner sessions — no client data on these yet,
    // so they're safe to surface on the client-facing landing screen.
    const drafts = cases.filter(c => isDraftCase(c) && (!userId || c.created_by === userId))

    const startPlan = async (type: CaseType) => {
        if (creating) return
        setCreating(type)
        setError(null)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push('/insurance/login'); return }

            const { data, error: insertError } = await supabase
                .from('cases')
                .insert({ case_type: type, stage: 'Touched Base', created_by: user.id })
                .select()
                .single()

            if (insertError) throw new Error(insertError.message)
            refreshCases()
            router.push(`/insurance/dashboard/cases/${data.id}?tab=workflow`)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not start the plan. Please try again.')
            setCreating(null)
        }
    }

    const discardDraft = async (id: string) => {
        setDiscardingId(id)
        // .select() returns the deleted rows — an empty array (with no error) means
        // RLS silently blocked the delete, which would otherwise look like the draft
        // "coming back" after a refresh.
        const { data, error: delError } = await supabase.from('cases').delete().eq('id', id).select('id')
        setDiscardingId(null)
        if (delError) { setError(delError.message); return }
        if (!data || data.length === 0) {
            setError('Could not delete this draft — please refresh and try again.')
            return
        }
        refreshCases()
    }

    return (
        <div className="max-w-4xl mx-auto space-y-7">
            <div>
                <h1 className="ios-page-title">Mortgage Planner</h1>
                <p className="page-subtitle">Pick a case type to start planning with your client.</p>
            </div>

            {error && <InlineAlert type="error" message={error} onDismiss={() => setError(null)} />}

            {/* Case-type cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {CASE_OPTIONS.map(({ type, label, icon: Icon, description, accent }) => {
                    const isCreating = creating === type
                    return (
                        <button
                            key={type}
                            type="button"
                            disabled={!!creating}
                            onClick={() => startPlan(type)}
                            className="card group flex items-start gap-4 p-5 text-left transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
                        >
                            <div
                                className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                                style={{ background: `${accent}15`, color: accent }}
                            >
                                {isCreating ? <Spinner size="sm" color={accent} /> : <Icon size={22} />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-base font-bold text-[#052d4a]">{label}</p>
                                    <ArrowRight size={15} className="text-slate-300 group-hover:text-[#03a9e7] transition-colors" />
                                </div>
                                <p className="text-sm text-slate-500 mt-1 leading-snug">{description}</p>
                            </div>
                        </button>
                    )
                })}
            </div>

            {/* Resume in-progress drafts */}
            {drafts.length > 0 && (
                <div className="space-y-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                        <Clock size={13} /> In progress
                    </p>
                    <div className="space-y-2">
                        {drafts.map(d => {
                            const opt = CASE_OPTIONS.find(o => o.type === d.case_type)
                            const Icon = opt?.icon ?? FileText
                            return (
                                <div key={d.id} className="card flex items-center gap-3 p-3.5">
                                    <div
                                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                        style={{ background: `${opt?.accent ?? '#64748b'}15`, color: opt?.accent ?? '#64748b' }}
                                    >
                                        <Icon size={17} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-slate-800">{opt?.label ?? d.case_type}</p>
                                        <p className="text-xs text-slate-400">Started {relativeTime(d.updated_at)} · no client yet</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => router.push(`/insurance/dashboard/cases/${d.id}?tab=workflow`)}
                                        className="text-sm px-3.5 py-1.5 rounded-lg bg-[#052d4a] text-white font-semibold hover:bg-[#0a3d63] transition-colors shrink-0"
                                    >
                                        Resume
                                    </button>
                                    <button
                                        type="button"
                                        disabled={discardingId === d.id}
                                        onClick={() => discardDraft(d.id)}
                                        className="p-2 text-slate-300 hover:text-red-500 transition-colors shrink-0 disabled:opacity-50"
                                        aria-label="Discard draft"
                                    >
                                        {discardingId === d.id ? <Spinner size="sm" color="#94a3b8" /> : <Trash2 size={16} />}
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
