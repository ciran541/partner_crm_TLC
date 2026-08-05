'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { CaseType } from '@/lib/types'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { usePagedCases } from '@/lib/insurance/usePagedCases'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import WelcomeChecklist from '@/components/insurance/onboarding/WelcomeChecklist'
import DashboardPromoBanner from '@/components/insurance/promotions/DashboardPromoBanner'
import {
    RefreshCcw, ShoppingCart, Users, TrendingUp, ArrowRight,
    Clock, Trash2, FileText, Search,
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
    const [creating, setCreating] = useState<CaseType | null>(null)
    const [discardingId, setDiscardingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [clientSearch, setClientSearch] = useState('')

    // Jump straight back into an existing client's workflow — name / mobile /
    // email, searched server-side across every case rather than over a downloaded
    // subset. `enabled` holds the request back until something is typed, so
    // landing on this page costs nothing.
    const { rows: clientMatches } = usePagedCases(
        { search: clientSearch, stage: 'all', limit: 6 },
        { enabled: clientSearch.trim().length > 0 },
    )

    // The signed-in user's own in-progress planner sessions — no client data on
    // these yet, so they are safe to surface on a screen an agent opens in front
    // of a client. `mine` is resolved from the session server-side, so an admin
    // sees their own drafts here rather than everybody's.
    const { rows: drafts } = usePagedCases({
        draftsOnly: true,
        mine: true,
        stage: 'all',
        limit: 10,
    })

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
            invalidateCaseData()
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
        invalidateCaseData()
    }

    return (
        <div className="max-w-4xl mx-auto space-y-7">
            <WelcomeChecklist />

            <div>
                <h1 className="ios-page-title">Mortgage Planner</h1>
                <p className="page-subtitle">Pick a case type to start planning with your client.</p>
            </div>

            {/* Bank promotions expire — surface them where every agent starts the
                day, before they open a case. Renders nothing when none are live. */}
            <DashboardPromoBanner />

            {/* Quick-open an existing client's workflow — no need to dig through Cases */}
            <div className="relative">
                <div className="relative">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                        type="text"
                        value={clientSearch}
                        onChange={e => setClientSearch(e.target.value)}
                        placeholder="Open an existing client — name / mobile / email"
                        className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-800 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12"
                    />
                </div>
                {clientSearch.trim() && (
                    <div className="absolute z-20 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                        {clientMatches.length === 0 ? (
                            <p className="px-4 py-3 text-sm text-slate-400">No matching client found.</p>
                        ) : clientMatches.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => router.push(`/insurance/dashboard/cases/${c.id}?tab=workflow`)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 truncate">{c.client_name || 'Unnamed'}</p>
                                    <p className="text-xs text-slate-400 truncate">
                                        {c.case_type}{c.client_mobile ? ` · ${c.client_mobile}` : ''}{c.client_email ? ` · ${c.client_email}` : ''}
                                    </p>
                                </div>
                                <ArrowRight size={15} className="text-slate-300 shrink-0" />
                            </button>
                        ))}
                    </div>
                )}
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
