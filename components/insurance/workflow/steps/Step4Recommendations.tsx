'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MortgagePackage } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { recommendPackages, type RecommendCriteria, type RecommendedPackage } from '@/lib/insurance/rateRecommend'
import Spinner from '@/components/shared/Spinner'
import { Sparkles, Check, TrendingUp, AlertTriangle, ChevronDown } from 'lucide-react'

interface Props {
    criteria: RecommendCriteria
    selectedId?: string
    onSelect: (rec: RecommendedPackage, sora: SoraRates | null) => void
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`

export default function Step4Recommendations({ criteria, selectedId, onSelect }: Props) {
    const [packages, setPackages] = useState<MortgagePackage[]>([])
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [showAll, setShowAll] = useState(false)
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        let active = true
        ;(async () => {
            setLoading(true)
            try {
                const res = await fetch('/api/insurance/rates')
                const json = await res.json()
                if (!active) return
                if (!res.ok) throw new Error(json.error || 'Failed to load packages')
                setPackages(json.data ?? [])
                setSora(json.sora ?? null)
            } catch (e: any) {
                if (active) setError(e.message)
            } finally {
                if (active) setLoading(false)
            }
        })()
        return () => { active = false }
    }, [])

    const ranked = useMemo(() => {
        const c: RecommendCriteria = showAll
            ? { ...criteria, preference: 'either', includeBuc: true }
            : criteria
        return recommendPackages(packages, sora, c)
    }, [packages, sora, criteria, showAll])

    const visible = expanded ? ranked : ranked.slice(0, 3)

    if (loading) return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex items-center justify-center">
            <Spinner size="sm" color="#03a9e7" label="Finding the best packages…" />
        </div>
    )

    if (error) return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Couldn&apos;t load packages: {error}. You can still enter the package manually below.
        </div>
    )

    return (
        <div className="rounded-xl border border-[#03a9e7]/30 bg-gradient-to-b from-sky-50/60 to-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#03a9e7]/15"><Sparkles size={15} className="text-[#03a9e7]" /></span>
                    <div>
                        <p className="text-sm font-bold text-[#052d4a]">Recommended packages</p>
                        <p className="text-[11px] text-slate-400">
                            {sora?.value_date
                                ? <>Floating computed from SORA as of <span className="font-medium">{sora.value_date}</span> (1M {sora.comp_sora_1m}% · 3M {sora.comp_sora_3m}%)</>
                                : 'Live SORA unavailable — floating estimates may be hidden'}
                        </p>
                    </div>
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                    <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="accent-[#03a9e7]" />
                    Show all package types
                </label>
            </div>

            {!sora && (
                <div className="mx-4 mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    No live SORA yet — floating rates can&apos;t be priced. Ask an admin to hit &ldquo;Refresh SORA&rdquo; on the Rates page. Fixed packages still compute.
                </div>
            )}

            {ranked.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                    No packages match this client&apos;s profile{!showAll && ' and rate preference'}.
                    {!showAll && <button onClick={() => setShowAll(true)} className="text-[#03a9e7] font-medium ml-1 hover:underline">Show all types</button>}
                </div>
            ) : (
                <div className="p-3 space-y-2.5">
                    {visible.map((rec, i) => (
                        <RecCard key={rec.pkg.id} rec={rec} rank={i + 1}
                            selected={selectedId === rec.pkg.id}
                            onSelect={() => onSelect(rec, sora)} />
                    ))}
                    {ranked.length > 3 && (
                        <button onClick={() => setExpanded(!expanded)}
                            className="w-full text-center text-xs font-medium text-slate-500 hover:text-[#03a9e7] py-1.5 flex items-center justify-center gap-1">
                            {expanded ? 'Show fewer' : `Show ${ranked.length - 3} more`}
                            <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}

function RecCard({ rec, rank, selected, onSelect }: { rec: RecommendedPackage; rank: number; selected: boolean; onSelect: () => void }) {
    const { pkg, projection, savings, eligible } = rec
    const saving = savings?.monthlySaving ?? null

    return (
        <div className={`rounded-xl border p-3.5 transition-all ${selected ? 'border-[#03a9e7] bg-sky-50 ring-1 ring-[#03a9e7]/30' : 'border-slate-200 bg-white hover:border-[#03a9e7]/40'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        {rank === 1 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#03a9e7] text-white">BEST</span>}
                        <span className="font-bold text-[#052d4a] text-sm">{pkg.bank}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{pkg.category}</span>
                        <span className="text-[10px] text-slate-400">{pkg.lockin_years === 0 ? 'No lock-in' : `${pkg.lockin_years}Y lock-in`}</span>
                    </div>
                    <p className="text-[12px] text-slate-600 mt-0.5 leading-snug">{pkg.package_name}</p>
                </div>
                <button onClick={onSelect}
                    className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors ${selected ? 'bg-[#03a9e7] text-white' : 'border border-[#03a9e7] text-[#03a9e7] hover:bg-sky-50'}`}>
                    {selected ? <><Check size={13} /> Selected</> : 'Select'}
                </button>
            </div>

            {/* per-year computed rates + installment */}
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
                {projection.perYear.slice(0, 4).map((p, i) => (
                    <span key={i} className="text-[11px] text-slate-500 tabular-nums">
                        Y{p.year} <span className="font-semibold text-slate-700">{p.ratePct != null ? `${p.ratePct.toFixed(2)}%` : '—'}</span>
                        {p.installment != null && <span className="text-slate-400"> · {fmt(p.installment)}/mo</span>}
                    </span>
                ))}
            </div>

            {/* savings + eligibility row */}
            <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex items-center gap-4 flex-wrap text-xs">
                {saving != null ? (
                    <span className={`inline-flex items-center gap-1 font-semibold ${saving > 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        <TrendingUp size={13} /> {saving >= 0 ? '+' : '−'}{fmt(Math.abs(saving))}/mo
                        {savings && <span className="text-slate-400 font-normal">· net 2yr {savings.netSaving2yr >= 0 ? '+' : '−'}{fmt(Math.abs(savings.netSaving2yr))}</span>}
                    </span>
                ) : (
                    <span className="text-slate-400">Savings: enter current rate in Step 1</span>
                )}
                {eligible === false && <span className="inline-flex items-center gap-1 text-red-600"><AlertTriangle size={12} /> TDSR exceeded</span>}
                {eligible === true && <span className="text-emerald-600">✓ Within TDSR</span>}
            </div>

            {rec.reasons.length > 0 && (
                <p className="mt-1.5 text-[10px] text-slate-400">{rec.reasons.join(' · ')}</p>
            )}
        </div>
    )
}
