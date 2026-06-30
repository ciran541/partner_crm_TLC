'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MortgagePackage } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { recommendPurchasePackages, type PurchaseRecommendation } from '@/lib/insurance/purchaseRecommend'
import { workflowPropType, packageStyle, stripBankPrefix, shortLoan, groupByRateTypeColumn, RATE_TYPE_OPTIONS, FEATURE_OPTIONS } from '@/lib/insurance/rateFilters'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import Spinner from '@/components/shared/Spinner'
import PackageCompareModal, { type ComparePackageItem } from './PackageCompareModal'
import { Sparkles, Check, AlertTriangle, ChevronDown, Lock, LockOpen, SlidersHorizontal, RefreshCcw, Columns2, CheckSquare, Square } from 'lucide-react'

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
    priorityBanks?: string[]                       // banks where the client holds priority status
    selectedId?: string
    onSelect: (rec: PurchaseRecommendation, sora: SoraRates | null) => void
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`

// New-purchase recommendation deliberately uses only loan size, property type and
// rate preference — no income/TDSR (precise on paper but unreliable vs the bank's
// real assessment), no horizon signals.
export default function PurchasePackages({ loan, tenureYears, propertyType, bucOnly, priorityBanks, selectedId, onSelect }: Props) {
    const [packages, setPackages] = useState<MortgagePackage[]>([])
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({})
    const toggleDetails = (id: string) => setOpenDetails(prev => ({ ...prev, [id]: !prev[id] }))
    // Each column shows only the top few by default; expand per-column to see the rest.
    const COLUMN_LIMIT = 3
    const [expandedCols, setExpandedCols] = useState<Set<string>>(new Set())
    const toggleCol = (key: string) => setExpandedCols(prev => {
        const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n
    })
    // Compare — pick up to 2 packages to view side-by-side (ephemeral, separate from the proposal pick).
    const [compareIds, setCompareIds] = useState<string[]>([])
    const [compareOpen, setCompareOpen] = useState(false)
    const toggleCompare = (id: string) => setCompareIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : prev)

    // Rates-page refine pills (ephemeral). Granular rate type only applies to a
    // completed purchase; an uncompleted (BUC) one has only BUC packages, so the
    // rate-type row is hidden. Start empty — the list stays hidden until the agent
    // picks at least one filter (rate type or feature).
    const showRateTypePills = !bucOnly
    const [rateTypes, setRateTypes] = useState<Set<string>>(new Set())
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
        rateTypes, features, priorityBanks,
    }), [packages, sora, loan, tenureYears, propertyType, bucOnly, rateTypes, features, priorityBanks])

    // Don't surface any package until the agent has narrowed with at least one
    // filter. BUC has no rate-type pills to pick, so it shows immediately.
    const needsFilter = showRateTypePills && rateTypes.size === 0 && features.size === 0
    // Group the ranked list into rate-type columns (1Y / 2Y / 3Y / 5Y Fixed,
    // Floating, BUC) — same buckets as the Rates browse tab.
    const columns = groupByRateTypeColumn(ranked)
    const cheapestId = ranked[0]?.pkg.id
    const compareItems: ComparePackageItem[] = compareIds
        .map(id => ranked.find(r => r.pkg.id === id))
        .filter((r): r is PurchaseRecommendation => !!r)
        .map(r => ({
            pkg: r.pkg,
            year1Pct: r.projection.perYear[0]?.ratePct ?? null,
            monthly: r.projection.newMonthly,
            avgLockinPct: r.projection.avgRateLockinPct,
        }))

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

    return (
        <>
        <div className="rounded-xl border border-[#03a9e7]/30 bg-gradient-to-b from-sky-50/60 to-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#03a9e7]/15"><Sparkles size={15} className="text-[#03a9e7]" /></span>
                <div>
                    <p className="text-sm font-bold text-[#052d4a] flex items-center gap-2 flex-wrap">
                        Recommended packages
                        {bucOnly && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Floating only · uncompleted</span>}
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

            {needsFilter ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">
                    Select a <span className="font-medium text-slate-600">rate type</span> or feature above to see recommended packages.
                </div>
            ) : !ranked.length ? (
                <div className="px-4 py-6 text-sm text-slate-500">
                    No packages match these filters. Try removing one.
                </div>
            ) : (
                /* Grouped into rate-type columns, side-by-side like the Rates browse tab. */
                <div className="overflow-x-auto p-3">
                    <div className="flex gap-3 items-start" style={{ minWidth: `${columns.length * 264 + Math.max(0, columns.length - 1) * 12}px` }}>
                        {columns.map(({ col, items }) => {
                            const colExpanded = expandedCols.has(col.key)
                            const shown = colExpanded ? items : items.slice(0, COLUMN_LIMIT)
                            return (
                                <div key={col.key} className="w-[264px] flex-shrink-0">
                                    <div className="mb-2 px-0.5">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <span className="font-bold text-[12px] text-[#052d4a] tracking-tight">{col.label}</span>
                                            <span className="text-[11px] font-medium text-slate-400 tabular-nums">{items.length}</span>
                                        </div>
                                        <div className="h-[2px] rounded-full" style={{ background: col.accentHex }} />
                                    </div>
                                    <div className="space-y-2">
                                        {shown.map(rec => renderCard(rec))}
                                    </div>
                                    {items.length > COLUMN_LIMIT && (
                                        <button type="button" onClick={() => toggleCol(col.key)}
                                            className="w-full mt-2 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-slate-400 hover:text-[#03a9e7] rounded-md border border-slate-100">
                                            {colExpanded ? 'Show fewer' : `Show all ${items.length}`} <ChevronDown size={12} className={colExpanded ? 'rotate-180' : ''} />
                                        </button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {compareIds.length > 0 && (
                <div className="px-4 py-2.5 border-t border-slate-100 bg-sky-50/50 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-500">{compareIds.length}/2 selected to compare</span>
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setCompareIds([])} className="text-[11px] text-slate-400 hover:text-slate-700 underline">Clear</button>
                        <button type="button" disabled={compareIds.length < 2} onClick={() => setCompareOpen(true)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#03a9e7] text-white hover:bg-[#0290c5] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                            <Columns2 size={12} /> Compare
                        </button>
                    </div>
                </div>
            )}
        </div>

        {compareOpen && compareItems.length === 2 && (
            <PackageCompareModal items={compareItems} onClose={() => setCompareOpen(false)} />
        )}
        </>
    )

    function renderCard(rec: PurchaseRecommendation) {
        const isSelected = rec.pkg.id === selectedId
        const inCompare = compareIds.includes(rec.pkg.id)
        const compareDisabled = !inCompare && compareIds.length >= 2
        const monthly = rec.projection.newMonthly
        const year1 = rec.projection.perYear[0]?.ratePct
        const isOpen = !!openDetails[rec.pkg.id]
        const scheduleLines = formatRateSchedule(rec.pkg.rate_schedule)
        const isCheapest = rec.pkg.id === cheapestId
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
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#052d4a] truncate flex items-center gap-1.5">
                                {rec.pkg.lockin_years ? <Lock size={12} className="text-slate-400 shrink-0" /> : <LockOpen size={12} className="text-slate-400 shrink-0" />}
                                {rec.pkg.bank}
                                {rec.pkg.lockin_years ? ` · ${rec.pkg.lockin_years}Y lock-in` : ' · No lock-in'}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{stripBankPrefix(rec.pkg.package_name, rec.pkg.bank)}</p>
                            {(isCheapest || hasSubsidy || rec.appeal || style) && (
                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                    {isCheapest && !rec.appeal && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#03a9e7]/10 text-[#03a9e7] border border-[#03a9e7]/30">Lowest rate</span>}
                                    {rec.appeal && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">Appeal · needs {shortLoan(rec.pkg.min_loan_size)}</span>}
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

                {/* Compare toggle + details expander */}
                <div className="flex items-stretch border-t border-slate-100 divide-x divide-slate-100">
                    <button type="button" onClick={() => toggleCompare(rec.pkg.id)} disabled={compareDisabled}
                        className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-colors ${
                            inCompare ? 'text-[#03a9e7]' : compareDisabled ? 'text-slate-300 cursor-not-allowed' : 'text-slate-400 hover:text-[#03a9e7]'}`}>
                        {inCompare ? <CheckSquare size={12} /> : <Square size={12} />} Compare
                    </button>
                    <button type="button" onClick={() => toggleDetails(rec.pkg.id)}
                        className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-slate-400 hover:text-[#03a9e7]">
                        {isOpen ? 'Hide' : 'Details'} <ChevronDown size={12} className={isOpen ? 'rotate-180' : ''} />
                    </button>
                </div>

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
    }
}
