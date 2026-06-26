'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MortgagePackage } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { recommendPurchasePackages, type PurchaseRecommendation } from '@/lib/insurance/purchaseRecommend'
import { workflowPropType, seedRateTypesFromPreference, packageStyle, stripBankPrefix, RATE_TYPE_OPTIONS, FEATURE_OPTIONS } from '@/lib/insurance/rateFilters'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import Spinner from '@/components/shared/Spinner'
import { Sparkles, Check, AlertTriangle, ChevronDown, Lock, LockOpen, SlidersHorizontal, RefreshCcw } from 'lucide-react'

/** Flexi / Traditional badge — matches the Rates page. */
function StyleBadge({ style }: { style: 'flexi' | 'traditional' | null }) {
    if (!style) return null
    return style === 'flexi'
        ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#03a9e7] bg-sky-50 border border-[#03a9e7]/30 rounded-full px-1.5 py-0.5 whitespace-nowrap"><RefreshCcw size={9} className="shrink-0" />Flexi</span>
        : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-1.5 py-0.5 whitespace-nowrap"><Lock size={9} className="text-slate-400 shrink-0" />Traditional</span>
}

// Granular Fixed-lock-in + Floating pills (BUC is property-driven, never a manual pill).
const REFINE_RATE_TYPES = RATE_TYPE_OPTIONS.filter(o => o.key !== 'BUC')

function RefinePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button type="button" onClick={onClick}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                active ? 'bg-[#052d4a] text-white border-[#052d4a]'
                       : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'}`}>
            {children}
        </button>
    )
}

interface Props {
    loan: number                                   // loan size — filters min loan + prices the package
    tenureYears: number                            // prices the monthly instalment
    propertyType?: 'hdb' | 'private_condo' | 'landed' | 'ec'
    bucOnly?: boolean                              // uncompleted property → floating/BUC packages only
    preference?: 'fixed' | 'floating' | 'either'   // rate preference
    priorityBanks?: string[]                       // banks where the client holds priority status
    selectedId?: string
    excludeBank?: string                           // omit packages from this bank (e.g. IPA bank)
    onSelect: (rec: PurchaseRecommendation, sora: SoraRates | null) => void
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`

// New-purchase recommendation deliberately uses only loan size, property type and
// rate preference — no income/TDSR (precise on paper but unreliable vs the bank's
// real assessment), no horizon signals.
export default function PurchasePackages({ loan, tenureYears, propertyType, bucOnly, preference, priorityBanks, selectedId, excludeBank, onSelect }: Props) {
    const [packages, setPackages] = useState<MortgagePackage[]>([])
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [expanded, setExpanded] = useState(false)
    const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({})
    const toggleDetails = (id: string) => setOpenDetails(prev => ({ ...prev, [id]: !prev[id] }))

    // Rates-page refine pills (ephemeral). Granular rate type only applies to a
    // completed purchase; an uncompleted (BUC) one has only BUC packages, so the
    // rate-type row is hidden. Seeded once from the client's saved preference.
    const showRateTypePills = !bucOnly
    const [rateTypes, setRateTypes] = useState<Set<string>>(
        () => showRateTypePills ? seedRateTypesFromPreference(preference) : new Set())
    const [features, setFeatures] = useState<Set<string>>(() => new Set())
    const toggle = (set: Set<string>, setter: (s: Set<string>) => void, key: string) => {
        const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); setter(n)
    }

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
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Failed to load packages')
            } finally {
                if (active) setLoading(false)
            }
        })()
        return () => { active = false }
    }, [])

    const ranked = useMemo(() => recommendPurchasePackages(packages, sora, {
        loan, tenureYears,
        propType: workflowPropType(propertyType, !!bucOnly),
        bucOnly,
        preference: 'either',          // BUC boundary only; the rate-type pills drive fixed/floating
        rateTypes, features, priorityBanks, excludeBank,
    }), [packages, sora, loan, tenureYears, propertyType, bucOnly, rateTypes, features, priorityBanks, excludeBank])

    const visible = expanded ? ranked : ranked.slice(0, 3)

    if (loading) return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex items-center justify-center">
            <Spinner size="sm" color="#03a9e7" label="Finding the best packages…" />
        </div>
    )

    if (error) return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Couldn&apos;t load packages: {error}.
        </div>
    )

    if (!ranked.length) return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No matching packages yet for this property type. Admins can add packages on the Rates page.
        </div>
    )

    return (
        <div className="rounded-xl border border-[#03a9e7]/30 bg-gradient-to-b from-sky-50/60 to-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#03a9e7]/15"><Sparkles size={15} className="text-[#03a9e7]" /></span>
                <div>
                    <p className="text-sm font-bold text-[#052d4a] flex items-center gap-2 flex-wrap">
                        Recommended packages
                        {bucOnly && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Floating only · uncompleted</span>}
                        {!bucOnly && preference && preference !== 'either' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">{preference === 'fixed' ? 'Fixed preferred' : 'Floating preferred'}</span>}
                    </p>
                    <p className="text-[11px] text-slate-400">
                        Priced for {fmt(loan)} over {tenureYears} yrs · {sora?.value_date
                            ? <>floating from SORA as of <span className="font-medium">{sora.published_date ?? sora.value_date}</span></>
                            : 'live SORA unavailable'}
                    </p>
                </div>
            </div>

            {!sora && (
                <div className="mx-4 mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    No live SORA yet — floating rates can&apos;t be priced. Ask an admin to hit &ldquo;Refresh SORA&rdquo; on the Rates page. Fixed packages still compute.
                </div>
            )}
            {excludeBank && (
                <div className="mx-4 mt-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[12px] text-slate-500">
                    Packages from <span className="font-semibold">{excludeBank}</span> (IPA bank) are excluded — compare other banks before deciding.
                </div>
            )}

            {/* Refine — granular rate type + features (Rates-page parity) */}
            <div className="px-4 pt-3 space-y-2">
                {showRateTypePills && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
                            <SlidersHorizontal size={11} /> Rate type
                        </span>
                        {REFINE_RATE_TYPES.map(o => (
                            <RefinePill key={o.key} active={rateTypes.has(o.key)} onClick={() => toggle(rateTypes, setRateTypes, o.key)}>
                                {o.label}
                            </RefinePill>
                        ))}
                    </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Features</span>
                    {FEATURE_OPTIONS.map(o => (
                        <RefinePill key={o.key} active={features.has(o.key)} onClick={() => toggle(features, setFeatures, o.key)}>
                            {o.label}
                        </RefinePill>
                    ))}
                </div>
            </div>

            <div className="p-3 space-y-2">
                {visible.map(rec => {
                    const isSelected = rec.pkg.id === selectedId
                    const monthly = rec.projection.newMonthly
                    const year1 = rec.projection.perYear[0]?.ratePct
                    const isOpen = !!openDetails[rec.pkg.id]
                    const scheduleLines = formatRateSchedule(rec.pkg.rate_schedule)
                    const isCheapest = rec.pkg.id === ranked[0]?.pkg.id
                    const hasSubsidy = !!rec.pkg.subsidies && !/^\s*(no|none|nil)/i.test(rec.pkg.subsidies)
                    const style = packageStyle(rec.pkg)
                    return (
                        <div key={rec.pkg.id}
                            className={`rounded-lg border transition-all overflow-hidden ${
                                isSelected ? 'border-[#03a9e7] bg-sky-50 shadow-sm' : 'border-slate-200 bg-white'
                            }`}
                        >
                            {/* Click body to select */}
                            <button type="button" onClick={() => onSelect(rec, sora)} className="w-full text-left p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-[#052d4a] truncate flex items-center gap-1.5">
                                            {rec.pkg.lockin_years ? <Lock size={12} className="text-slate-400" /> : <LockOpen size={12} className="text-slate-400" />}
                                            {rec.pkg.bank} · {rec.pkg.category}
                                            {rec.pkg.lockin_years ? ` · ${rec.pkg.lockin_years}Y lock-in` : ' · No lock-in'}
                                        </p>
                                        <p className="text-xs text-slate-500 truncate">{stripBankPrefix(rec.pkg.package_name, rec.pkg.bank)}</p>
                                        {(isCheapest || hasSubsidy || rec.appeal || style) && (
                                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                {isCheapest && !rec.appeal && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#03a9e7]/10 text-[#03a9e7] border border-[#03a9e7]/30">Lowest rate</span>}
                                                {rec.appeal && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">Appeal</span>}
                                                {hasSubsidy && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Subsidy / rebate</span>}
                                                <StyleBadge style={style} />
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-right shrink-0">
                                        {year1 != null && <p className="text-sm font-bold text-[#03a9e7]">{year1.toFixed(2)}%</p>}
                                        {monthly != null
                                            ? <p className="text-xs text-slate-600">{fmt(monthly)}</p>
                                            : <p className="text-[11px] text-slate-400">not auto-priced</p>}
                                        {isSelected && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#03a9e7] mt-1"><Check size={12} /> Selected</span>}
                                    </div>
                                </div>
                            </button>

                            {/* Expand for full package details */}
                            <button type="button" onClick={() => toggleDetails(rec.pkg.id)}
                                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-[#03a9e7] border-t border-slate-100">
                                {isOpen ? 'Hide details' : 'Full package details'} <ChevronDown size={12} className={isOpen ? 'rotate-180' : ''} />
                            </button>

                            {isOpen && (
                                <div className="px-3 pb-3 pt-1 space-y-2 text-xs text-slate-600 bg-slate-50/60 border-t border-slate-100">
                                    <div>
                                        <p className="font-semibold text-slate-500 uppercase tracking-wide text-[10px] mb-1">Rate schedule</p>
                                        <ul className="space-y-0.5">
                                            {scheduleLines.map((l, i) => <li key={i} className="flex gap-1.5"><span className="text-slate-300">•</span>{l}</li>)}
                                        </ul>
                                    </div>
                                    {rec.pkg.features?.length > 0 && (
                                        <div>
                                            <p className="font-semibold text-slate-500 uppercase tracking-wide text-[10px] mb-1">Features</p>
                                            <ul className="space-y-0.5">
                                                {rec.pkg.features.map((f, i) => <li key={i} className="flex gap-1.5"><span className="text-emerald-400">✓</span>{f}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                    {rec.pkg.subsidies && <p><span className="font-semibold text-slate-500">Subsidies: </span>{rec.pkg.subsidies}</p>}
                                    {rec.pkg.min_loan_note && <p><span className="font-semibold text-slate-500">Min loan: </span>{rec.pkg.min_loan_note}</p>}
                                    {rec.pkg.remarks && <p className="text-slate-500 italic">{rec.pkg.remarks}</p>}
                                    {rec.projection.notes.length > 0 && (
                                        <p className="text-[11px] text-amber-600">{rec.projection.notes.join(' · ')}</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {ranked.length > 3 && (
                <button type="button" onClick={() => setExpanded(v => !v)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-500 hover:text-[#03a9e7] border-t border-slate-100">
                    {expanded ? 'Show fewer' : `Show all ${ranked.length}`} <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
                </button>
            )}
        </div>
    )
}
