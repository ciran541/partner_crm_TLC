'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MortgagePackage } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
import { recommendPackages, type RecommendedPackage } from '@/lib/insurance/rateRecommend'
import { workflowPropType, packageStyle, stripBankPrefix, shortLoan, groupByRateTypeColumn, RATE_TYPE_OPTIONS, FEATURE_OPTIONS } from '@/lib/insurance/rateFilters'
import { formatRateSchedule, isSoraStale, soraAgeDays } from '@/lib/insurance/rateSchedule'
import { matchPromotions, type MatchedPromotion } from '@/lib/insurance/promotions'
import type { BankPromotion } from '@/lib/types/promotions'
import type { CaseType } from '@/lib/types/insurance'
import PromoBadge from '@/components/insurance/promotions/PromoBadge'
import PromoDetail from '@/components/insurance/promotions/PromoDetail'
import Spinner from '@/components/shared/Spinner'
import RateCompareModal from '@/components/insurance/rates/RateCompareModal'
import { Sparkles, Check, AlertTriangle, ChevronDown, Lock, LockOpen, TrendingDown, SlidersHorizontal, RefreshCcw, Columns2, CheckSquare, Square, Crown } from 'lucide-react'

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
    loan: number
    tenureYears: number
    propertyType?: 'hdb' | 'private_condo' | 'landed'
    includeBuc?: boolean
    currentRatePct?: number
    clawbackAmount?: number
    priorityBanks?: string[]        // banks where the client holds priority status (lowers min-loan tier)
    currentBank?: string            // client's existing bank — excluded (refinancing moves away)
    selectedId?: string
    caseId?: string                 // enables emailing the comparison to the client
    clientEmail?: string
    clientName?: string
    // Shared by Refinancing, Equity Loan and Decoupling — promotions are filtered
    // on it, since a bank may run one for refinancing but not equity.
    caseType?: CaseType
    onSelect: (rec: RecommendedPackage, sora: SoraRates | null, promos: MatchedPromotion[]) => void
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`

export default function RefiPackages({
    loan, tenureYears, propertyType, includeBuc, currentRatePct, clawbackAmount, priorityBanks, currentBank, selectedId, caseId, clientEmail, clientName, caseType = 'Refinancing', onSelect,
}: Props) {
    const [packages, setPackages] = useState<MortgagePackage[]>([])
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [promotions, setPromotions] = useState<BankPromotion[]>([])
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
    // Compare — pick up to 3 packages to view side-by-side (ephemeral, separate from the proposal pick).
    const MAX_COMPARE = 3
    const [compareIds, setCompareIds] = useState<string[]>([])
    const [compareOpen, setCompareOpen] = useState(false)
    const toggleCompare = (id: string) => setCompareIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : prev.length < MAX_COMPARE ? [...prev, id] : prev)

    // Rates-page refine pills (ephemeral). Granular rate type only applies to a
    // completed property; for a BUC/uncompleted one only BUC packages exist, so the
    // rate-type row is hidden. Start empty — the list stays hidden until the agent
    // picks at least one filter (rate type or feature).
    const showRateTypePills = !includeBuc
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
                setPromotions(json.promotions ?? [])
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Failed to load packages')
            } finally {
                if (active) setLoading(false)
            }
        })()
        return () => { active = false }
    }, [])

    const ranked = useMemo(() => recommendPackages(packages, sora, {
        outstandingLoan: loan,
        remainingTenureYears: tenureYears,
        currentRatePct,
        clawbackAmount,
        propType: workflowPropType(propertyType, !!includeBuc),
        priorityBanks,
        currentBank,
        preference: 'either',          // BUC boundary only; the rate-type pills drive fixed/floating
        rateTypes,
        features,
        includeBuc,
    }), [packages, sora, loan, tenureYears, currentRatePct, clawbackAmount, propertyType, includeBuc, priorityBanks, currentBank, rateTypes, features])

    // Promotions that apply to THIS case, keyed by bank. The tier is resolved
    // against this loan, so a card shows the client's actual figure ("$1,200")
    // rather than the promotion's whole range — and a bank whose promo excludes
    // this loan size gets nothing, which is the point of matching here.
    const promosByBank = useMemo(() => {
        const map = new Map<string, MatchedPromotion[]>()
        if (!promotions.length) return map
        for (const bank of new Set(packages.map(p => p.bank))) {
            const matched = matchPromotions(promotions, { bank, caseType, loanAmount: loan })
            if (matched.length) map.set(bank, matched)
        }
        return map
    }, [promotions, packages, caseType, loan])

    if (loading) return (
        <div className="rounded-xl border border-slate-200 bg-white p-6 flex items-center justify-center">
            <Spinner size="sm" color="#03a9e7" label="Finding the best packages…" />
        </div>
    )
    if (error) return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Couldn&apos;t load packages: {error}.</div>
    )
    // Don't surface any package until the agent has narrowed with at least one
    // filter. BUC has no rate-type pills to pick, so it shows immediately.
    const needsFilter = showRateTypePills && rateTypes.size === 0 && features.size === 0
    // Group the ranked list into rate-type columns (1Y / 2Y / 3Y / 5Y Fixed,
    // Floating, BUC) — same buckets as the Rates browse tab.
    const columns = groupByRateTypeColumn(ranked)
    const comparePkgs = compareIds
        .map(id => ranked.find(r => r.pkg.id === id)?.pkg)
        .filter((p): p is MortgagePackage => !!p)

    const card = (rec: RecommendedPackage, best: boolean) => {
        const promos = promosByBank.get(rec.pkg.bank) ?? []
        const isSelected = rec.pkg.id === selectedId
        const inCompare = compareIds.includes(rec.pkg.id)
        const compareDisabled = !inCompare && compareIds.length >= MAX_COMPARE
        const monthly = rec.projection.newMonthly
        const year1 = rec.projection.perYear[0]?.ratePct
        const saving = rec.savings?.monthlySaving ?? null
        const isOpen = !!openDetails[rec.pkg.id]
        const scheduleLines = formatRateSchedule(rec.pkg.rate_schedule)
        return (
            <div key={rec.pkg.id}
                className={`rounded-lg border transition-all overflow-hidden ${isSelected ? 'border-[#03a9e7] bg-sky-50 shadow-sm' : 'border-slate-200 bg-white'}`}>
                <button type="button" onClick={() => onSelect(rec, sora, promos)} className="w-full text-left p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#052d4a] truncate flex items-center gap-1.5">
                                {rec.pkg.lockin_years ? <Lock size={12} className="text-slate-400 shrink-0" /> : <LockOpen size={12} className="text-slate-400 shrink-0" />}
                                {rec.pkg.bank}
                                {rec.pkg.lockin_years ? ` · ${rec.pkg.lockin_years}Y lock-in` : ' · No lock-in'}
                            </p>
                            <p className="text-xs text-slate-500 truncate">{stripBankPrefix(rec.pkg.package_name, rec.pkg.bank)}</p>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {best && !rec.appeal && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#03a9e7]/10 text-[#03a9e7] border border-[#03a9e7]/30">Best match</span>}
                                {rec.priority && <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200"><Crown size={10} /> Priority</span>}
                                {rec.appeal && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">Appeal · needs {shortLoan(rec.pkg.min_loan_size)}</span>}
                                {saving != null && saving > 0 && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1"><TrendingDown size={10} /> Save {fmt(saving)}</span>}
                                <StyleBadge style={packageStyle(rec.pkg)} />
                                {promos.map(m => <PromoBadge key={m.promo.id} matched={m} compact />)}
                            </div>
                        </div>
                        <div className="text-right shrink-0">
                            {year1 != null && <p className="text-sm font-bold text-[#03a9e7]">{year1.toFixed(2)}%</p>}
                            {monthly != null ? <p className="text-xs text-slate-600">{fmt(monthly)}</p> : <p className="text-[11px] text-slate-400">not auto-priced</p>}
                            {isSelected && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#03a9e7] mt-1"><Check size={12} /> Selected</span>}
                        </div>
                    </div>
                </button>
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
                            <ul className="space-y-0.5">{scheduleLines.map((l, i) => <li key={i} className="flex gap-1.5"><span className="text-slate-300">•</span>{l}</li>)}</ul>
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
                        {promos.map(m => <PromoDetail key={m.promo.id} matched={m} />)}
                        {rec.savings?.netSaving2yr != null && <p><span className="font-semibold text-slate-500">2-yr net saving: </span>{fmt(rec.savings.netSaving2yr)}</p>}
                        {rec.projection.notes.length > 0 && <p className="text-[11px] text-amber-600">{rec.projection.notes.join(' · ')}</p>}
                    </div>
                )}
            </div>
        )
    }

    return (
        <>
        <div className="rounded-xl border border-[#03a9e7]/30 bg-gradient-to-b from-sky-50/60 to-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#03a9e7]/15"><Sparkles size={15} className="text-[#03a9e7]" /></span>
                <div>
                    <p className="text-sm font-bold text-[#052d4a]">Recommended packages</p>
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
            {sora && isSoraStale(sora.value_date) && (
                <div className="mx-4 mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-800 flex items-start gap-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    Stored SORA is {soraAgeDays(sora.value_date)} days old — the daily refresh may be failing, so floating rates below use a stale benchmark. Ask an admin to hit &ldquo;Refresh SORA&rdquo; on the Rates page.
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
                                        {shown.map((r, i) => card(r, i === 0))}
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
                    <span className="text-[11px] font-medium text-slate-500">{compareIds.length}/{MAX_COMPARE} selected to compare</span>
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

        {compareOpen && comparePkgs.length >= 2 && (
            <RateCompareModal
                packages={comparePkgs}
                sora={sora}
                initialLoan={loan}
                initialTenure={tenureYears}
                caseId={caseId}
                clientEmail={clientEmail}
                clientName={clientName}
                onRemove={id => {
                    const next = compareIds.filter(x => x !== id)
                    setCompareIds(next)
                    if (next.length < 2) setCompareOpen(false)
                }}
                onClose={() => setCompareOpen(false)}
            />
        )}
        </>
    )
}
