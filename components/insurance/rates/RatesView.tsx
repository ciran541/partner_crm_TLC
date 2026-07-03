'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MortgagePackage, MortgagePackageInput, RateScheduleEntry, RateCategory } from '@/lib/types/rates'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import { effectiveRate } from '@/lib/insurance/rateRecommend'
import { fixedRateYears, parsePriorityMin, applyLoanSizeFilter, matchesPropType, matchesRateType, matchesFeature, stripBankPrefix, packageStyle, shortLoan, RATE_TYPE_OPTIONS, FEATURE_OPTIONS, type PropTypeFilter } from '@/lib/insurance/rateFilters'
import RatePackageEditorModal from '@/components/insurance/rates/RatePackageEditorModal'
import RateIngestionModal from '@/components/insurance/rates/RateIngestionModal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import { Percent, Plus, Pencil, Copy, Trash2, Search, Lock, LockOpen, Wallet, Building2, X, ChevronDown, RefreshCcw, Upload, Eye } from 'lucide-react'
import type { SoraRates } from '@/lib/insurance/sora'

// ── Helpers ───────────────────────────────────────────────────────────────

function headlineRate(schedule: RateScheduleEntry[], sora: SoraRates | null) {
    const first = schedule?.[0]
    if (!first) return { big: '—', sub: '' }
    const { rate } = effectiveRate(first, sora)

    if (first.type === 'fixed') {
        const fixedYrs = schedule.filter(e => e.type === 'fixed' && !e.thereafter)
        const n = fixedYrs.length
        const allSame = fixedYrs.every(e => e.rate === first.rate)
        // "Yrs 1–3 · Fixed" when uniform; "Yr 1 · Entry rate" when rates step up
        const label = n <= 1 ? 'Yr 1 · Fixed'
            : allSame     ? `Yrs 1–${n} · Fixed`
            :               'Yr 1 · Entry rate'
        return { big: rate != null ? `${rate.toFixed(2)}%` : '—', sub: label }
    }

    // Floating
    const sub = `Yr 1 · ${first.reference || 'Floating'}`
    if (rate != null) return { big: `${rate.toFixed(2)}%`, sub }
    return { big: first.spread != null ? `+${first.spread.toFixed(2)}%` : (first.reference || '—'), sub }
}

function shortPropType(pt: string): string {
    const l = pt.toLowerCase()
    if (l.includes('executive')) return 'EC'
    if (pt === 'HDB / Private') return 'HDB / Pvt'
    return pt
}


// ── Filter config ─────────────────────────────────────────────────────────

const PROPERTY_TYPE_OPTIONS = [
    { value: 'hdb',               label: 'HDB'                          },
    { value: 'bto',               label: 'BTO'                          },
    { value: 'private_completed', label: 'Private (Completed)'          },
    { value: 'private_uc',        label: 'Private (Under Construction)' },
]

// ── Column definitions ────────────────────────────────────────────────────

interface ColumnDef {
    key: string; label: string
    accentClass: string   // Tailwind bg-* for card top bar + column underline
    accentHex: string     // Raw hex for inline styles where Tailwind can't arbitrary-escape
    match: (p: MortgagePackage) => boolean
}

const COLUMN_DEFS: ColumnDef[] = [
    { key: '1Y',       label: '1 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 1 },
    { key: '2Y',       label: '2 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 2 },
    { key: '3Y',       label: '3 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 3 },
    { key: '5Y',       label: '5 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && fixedRateYears(p) === 5 },
    { key: 'OTHFIX',   label: 'Other Fixed',    accentClass: 'bg-slate-500',  accentHex: '#64748b', match: p => p.category === 'Fixed' && ![1,2,3,5].includes(fixedRateYears(p)) },
    { key: 'FLOAT',    label: 'Floating',       accentClass: 'bg-[#03a9e7]', accentHex: '#03a9e7', match: p => p.category === 'Floating (Completed)' },
    { key: 'BUC',      label: 'BUC / BTO',      accentClass: 'bg-amber-500',  accentHex: '#f59e0b', match: p => p.category === 'BUC' },
]

// ── Filter logic ──────────────────────────────────────────────────────────

function isRateTypeDisabled(key: string, propType: PropTypeFilter) {
    if (key === 'BUC' && (propType === 'hdb' || propType === 'private_completed')) return true
    if (key !== 'BUC' && (propType === 'bto' || propType === 'private_uc')) return true
    return false
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function RatesView({ forceReadOnly = false }: { forceReadOnly?: boolean }) {
    const [admin, setAdmin] = useState(false)
    const [packages, setPackages] = useState<MortgagePackage[]>([])
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [refreshingSora, setRefreshingSora] = useState(false)
    const [editingBenchmark, setEditingBenchmark] = useState<string | null>(null)
    const [benchmarkInput, setBenchmarkInput] = useState('')
    const [savingBenchmark, setSavingBenchmark] = useState(false)
    const [loading, setLoading] = useState(true)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const [loanSize, setLoanSize]     = useState('')
    const [currentBank, setCurrentBank] = useState('')
    const [propType, setPropType]     = useState<PropTypeFilter>('')
    const [rateTypes, setRateTypes]   = useState<Set<string>>(new Set())
    const [features, setFeatures]     = useState<Set<string>>(new Set())
    const [priorityBanks, setPriorityBanks] = useState<Set<string>>(new Set())
    const [q, setQ]                   = useState('')

    const [editorOpen, setEditorOpen] = useState(false)
    const [ingestOpen, setIngestOpen] = useState(false)
    const [editing, setEditing]       = useState<MortgagePackage | null>(null)
    const [saving, setSaving]         = useState(false)
    const [busyId, setBusyId]         = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const res  = await fetch('/api/insurance/rates')
        const json = await res.json()
        if (res.ok) { setPackages(json.data ?? []); setAdmin(!forceReadOnly && !!json.isAdmin); setSora(json.sora ?? null) }
        else setAlert({ type: 'error', message: json.error || 'Failed to load packages' })
        setLoading(false)
    }, [forceReadOnly])
    useEffect(() => { load() }, [load])

    const rawLoanNum   = useMemo(() => { const n = parseFloat(loanSize.replace(/[,$\s]/g, '')); return isNaN(n) ? null : n }, [loanSize])
    const parsedLoan   = rawLoanNum !== null && rawLoanNum >= 100_000 ? rawLoanNum : null
    const loanSizeErr  = rawLoanNum !== null && rawLoanNum < 100_000 ? 'Min $100,000' : null

    const toggleSet = (set: Set<string>, key: string) => { const n = new Set(set); n.has(key) ? n.delete(key) : n.add(key); return n }

    const handlePropTypeChange = (v: PropTypeFilter) => {
        setPropType(v)
        if (v === 'bto' || v === 'private_uc') setRateTypes(new Set(['BUC']))
        else if (v === 'hdb' || v === 'private_completed') setRateTypes(prev => { const n = new Set(prev); n.delete('BUC'); return n })
    }

    const hasFilters = !!(loanSize || currentBank || propType || rateTypes.size || features.size || priorityBanks.size || q.trim())

    const clearFilters = () => {
        setLoanSize(''); setCurrentBank(''); setPropType('')
        setRateTypes(new Set()); setFeatures(new Set()); setPriorityBanks(new Set()); setQ('')
    }

    const filteredPackages = useMemo(() => {
        if (!hasFilters) return []
        let items: { pkg: MortgagePackage; appeal: boolean }[] = parsedLoan
            ? applyLoanSizeFilter(packages, parsedLoan, priorityBanks)
            : packages.map(p => ({ pkg: p, appeal: false }))
        if (currentBank)      items = items.filter(({ pkg }) => pkg.bank !== currentBank)
        if (propType)         items = items.filter(({ pkg }) => matchesPropType(pkg, propType))
        if (rateTypes.size)   items = items.filter(({ pkg }) => matchesRateType(pkg, rateTypes))
        if (features.size)    items = items.filter(({ pkg }) => matchesFeature(pkg, features))
        if (q.trim()) {
            const ql = q.trim().toLowerCase()
            items = items.filter(({ pkg }) => pkg.package_name.toLowerCase().includes(ql) || pkg.bank.toLowerCase().includes(ql))
        }
        return items
    }, [packages, parsedLoan, currentBank, propType, rateTypes, features, priorityBanks, q, hasFilters])

    const columns = useMemo(() =>
        COLUMN_DEFS
            .map(def => ({
                ...def,
                items: filteredPackages
                    .filter(({ pkg }) => def.match(pkg))
                    .sort((a, b) => (a.pkg.first_year_rate ?? Infinity) - (b.pkg.first_year_rate ?? Infinity)),
            }))
            .filter(col => col.items.length > 0),
        [filteredPackages]
    )

    const appealCount = filteredPackages.filter(i => i.appeal).length
    const draftIds = useMemo(() => packages.filter(p => p.status === 'draft').map(p => p.id), [packages])

    // ── Handlers ────────────────────────────────────────────────────────
    const handleSave = async (input: MortgagePackageInput) => {
        setSaving(true)
        try {
            const method = editing ? 'PATCH' : 'POST'
            const body   = editing ? { id: editing.id, input } : { input }
            const res    = await fetch('/api/admin/rates', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            const json   = await res.json()
            if (!res.ok) throw new Error(json.error || 'Save failed')
            setEditorOpen(false); setEditing(null)
            setAlert({ type: 'success', message: editing ? 'Package updated.' : 'Package created.' })
            await load()
        } catch (e: any) { setAlert({ type: 'error', message: e.message }) }
        finally { setSaving(false) }
    }

    const handleDuplicate = async (id: string) => {
        setBusyId(id)
        try {
            const res  = await fetch('/api/admin/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duplicateId: id }) })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Duplicate failed')
            setAlert({ type: 'success', message: 'Duplicated as draft — edit and publish when ready.' })
            await load()
            if (json.data) { setEditing(json.data); setEditorOpen(true) }
        } catch (e: any) { setAlert({ type: 'error', message: e.message }) }
        finally { setBusyId(null) }
    }

    const handlePublish = async (ids: string[]) => {
        if (!ids.length) return
        try {
            const res  = await fetch('/api/admin/rates/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Publish failed')
            setAlert({ type: 'success', message: `Published ${ids.length} package${ids.length !== 1 ? 's' : ''}.` })
            await load()
        } catch (e: any) { setAlert({ type: 'error', message: e.message }) }
    }

    const handleDelete = async (id: string) => {
        setBusyId(id)
        try {
            const res  = await fetch(`/api/admin/rates?id=${id}`, { method: 'DELETE' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Delete failed')
            setConfirmDelete(null)
            setAlert({ type: 'success', message: 'Package deleted.' })
            await load()
        } catch (e: any) { setAlert({ type: 'error', message: e.message }) }
        finally { setBusyId(null) }
    }

    const handleSaveBenchmark = async (key: string) => {
        const v = parseFloat(benchmarkInput)
        if (!Number.isFinite(v) || v < 0 || v > 20) {
            setAlert({ type: 'error', message: 'Enter a valid rate (0–20%)' }); return
        }
        setSavingBenchmark(true)
        try {
            const res  = await fetch('/api/admin/rates/sora', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: v }) })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Save failed')
            setSora(prev => prev ? { ...prev, benchmarks: { ...prev.benchmarks, [key]: v } } : prev)
            setAlert({ type: 'success', message: `${key} updated to ${v.toFixed(4)}%` })
            setEditingBenchmark(null)
        } catch (e: any) { setAlert({ type: 'error', message: e.message }) }
        finally { setSavingBenchmark(false) }
    }

    const handleRefreshSora = async () => {
        setRefreshingSora(true)
        try {
            const res  = await fetch('/api/admin/rates/sora', { method: 'POST' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Refresh failed')
            setSora(json.sora)
            setAlert({ type: 'success', message: `SORA updated — 1M ${json.sora.comp_sora_1m}% · 3M ${json.sora.comp_sora_3m}%` })
        } catch (e: any) { setAlert({ type: 'error', message: e.message }) }
        finally { setRefreshingSora(false) }
    }

    // ── Render ───────────────────────────────────────────────────────────
    return (
        <div>
            {/* ── Page header ─────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#03a9e7]/10">
                            <Percent size={20} className="text-[#03a9e7]" />
                        </span>
                        Mortgage Packages
                    </h1>
                    <p className="page-subtitle">
                        {admin
                            ? 'Add, edit, or duplicate packages to keep them current.'
                            : 'Filter by loan size and client profile to find the best rate.'}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* SORA pill */}
                    <div className="inline-flex items-center gap-2 text-[11px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                        <span className="font-semibold text-slate-400 uppercase tracking-wide text-[10px]">SORA</span>
                        {sora
                            ? <span className="text-slate-600 tabular-nums">1M {sora.comp_sora_1m}% · 3M {sora.comp_sora_3m}% <span className="text-slate-400">({sora.published_date ?? sora.value_date})</span></span>
                            : <span className="text-amber-600">not fetched</span>}
                        {admin && (
                            <button onClick={handleRefreshSora} disabled={refreshingSora} title="Fetch latest SORA"
                                className="ml-0.5 text-slate-400 hover:text-[#03a9e7] disabled:opacity-50 transition-colors">
                                <RefreshCcw size={12} className={refreshingSora ? 'animate-spin' : ''} />
                            </button>
                        )}
                    </div>
                    {/* Bank benchmark pills (FHR6, etc.) */}
                    {sora?.benchmarks && Object.entries(sora.benchmarks).map(([key, val]) => (
                        <div key={key} className="inline-flex items-center gap-2 text-[11px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                            <span className="font-semibold text-slate-400 uppercase tracking-wide text-[10px]">{key}</span>
                            {editingBenchmark === key ? (
                                <>
                                    <input
                                        autoFocus
                                        type="number" step="0.0001" min="0" max="20"
                                        value={benchmarkInput}
                                        onChange={e => setBenchmarkInput(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') handleSaveBenchmark(key); if (e.key === 'Escape') setEditingBenchmark(null) }}
                                        className="w-16 text-[11px] border border-slate-300 rounded px-1 py-0.5 tabular-nums outline-none focus:border-[#03a9e7]"
                                    />
                                    <span className="text-slate-400">%</span>
                                    <button onClick={() => handleSaveBenchmark(key)} disabled={savingBenchmark}
                                        className="text-emerald-600 hover:text-emerald-700 disabled:opacity-50 font-medium">
                                        {savingBenchmark ? '…' : 'Save'}
                                    </button>
                                    <button onClick={() => setEditingBenchmark(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                                </>
                            ) : (
                                <>
                                    <span className="text-slate-600 tabular-nums">{val.toFixed(4)}%</span>
                                    {admin && (
                                        <button onClick={() => { setBenchmarkInput(String(val)); setEditingBenchmark(key) }}
                                            title={`Edit ${key}`}
                                            className="ml-0.5 text-slate-400 hover:text-[#03a9e7] transition-colors">
                                            <Pencil size={11} />
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                    {admin && draftIds.length > 0 && (
                        <button onClick={() => handlePublish(draftIds)}
                            className="px-3 py-2 text-sm flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors">
                            <Eye size={14} /> Publish {draftIds.length} draft{draftIds.length !== 1 ? 's' : ''}
                        </button>
                    )}
                    {admin && (
                        <button onClick={() => setIngestOpen(true)}
                            className="btn-ghost px-3 py-2 text-sm flex items-center gap-1.5 border border-slate-200">
                            <Upload size={14} /> Import from sheet
                        </button>
                    )}
                    {admin && (
                        <button onClick={() => { setEditing(null); setEditorOpen(true) }}
                            className="btn-primary px-4 py-2 text-sm flex items-center gap-1.5 shadow-sm">
                            <Plus size={15} /> New Package
                        </button>
                    )}
                </div>
            </div>

            {alert && (
                <div className="mb-4">
                    <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />
                </div>
            )}

            {/* ── Filter panel ─────────────────────────────────────────── */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm mb-6 overflow-hidden">
                {/* Row 1 */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-100">
                    {/* Loan Amount */}
                    <div className="bg-white px-4 py-3">
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                            Loan Amount
                        </label>
                        <div className="relative">
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm select-none">$</span>
                            <input
                                type="text" inputMode="numeric"
                                value={loanSize} onChange={e => setLoanSize(e.target.value)}
                                placeholder="e.g. 350000"
                                className={`w-full pl-4 py-0.5 text-sm bg-transparent outline-none border-b-2 transition-colors placeholder:text-slate-300
                                    ${loanSizeErr ? 'border-amber-400 text-amber-700' : 'border-slate-200 focus:border-[#03a9e7]'}`}
                            />
                        </div>
                        <p className={`text-[10px] mt-1 ${loanSizeErr ? 'text-amber-500' : 'text-slate-400'}`}>
                            {loanSizeErr ?? 'Filters to best rate tier · ±10% for appeal'}
                        </p>
                    </div>
                    {/* Current Bank */}
                    <div className="bg-white px-4 py-3">
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                            Current Bank
                        </label>
                        <InsuranceBankDropdown value={currentBank} onChange={setCurrentBank} placeholder="N/A — show all banks" />
                        <p className="text-[10px] text-slate-400 mt-1">Client&apos;s existing bank won&apos;t appear</p>
                    </div>
                    {/* Search */}
                    <div className="bg-white px-4 py-3">
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Search</label>
                        <div className="relative">
                            <Search size={13} className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-300" />
                            <input value={q} onChange={e => setQ(e.target.value)}
                                placeholder="Package name or bank…"
                                className="w-full pl-5 py-0.5 text-sm bg-transparent outline-none border-b-2 border-slate-200 focus:border-[#03a9e7] transition-colors placeholder:text-slate-300" />
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="h-px bg-slate-100" />

                {/* Row 2: Rate Type + Property Type + Features */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-slate-100">
                    {/* Rate Type */}
                    <div className="bg-white px-4 py-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Rate Type</p>
                        <div className="flex flex-wrap gap-1.5">
                            {RATE_TYPE_OPTIONS.map(opt => {
                                const disabled = isRateTypeDisabled(opt.key, propType)
                                const on = rateTypes.has(opt.key)
                                return (
                                    <FilterPill key={opt.key} active={on} disabled={disabled}
                                        onClick={() => !disabled && setRateTypes(prev => toggleSet(prev, opt.key))}
                                        color="navy">
                                        {opt.label}
                                    </FilterPill>
                                )
                            })}
                        </div>
                    </div>
                    {/* Property Type */}
                    <div className="bg-white px-4 py-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Property Type</p>
                        <div className="flex flex-wrap gap-1.5">
                            {PROPERTY_TYPE_OPTIONS.map(opt => (
                                <FilterPill key={opt.value} active={propType === opt.value} color="blue"
                                    onClick={() => handlePropTypeChange(propType === opt.value ? '' : opt.value as PropTypeFilter)}>
                                    {opt.label}
                                </FilterPill>
                            ))}
                        </div>
                    </div>
                    {/* Features */}
                    <div className="bg-white px-4 py-3">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Features</p>
                        <div className="flex flex-wrap gap-1.5">
                            {FEATURE_OPTIONS.map(opt => (
                                <FilterPill key={opt.key} active={features.has(opt.key)} color="green"
                                    onClick={() => setFeatures(prev => toggleSet(prev, opt.key))}>
                                    {opt.label}
                                </FilterPill>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Row 3: Priority Banking */}
                <div className="h-px bg-slate-100" />
                <div className="bg-white px-4 py-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                        Priority / Privilege Banking
                        <span className="ml-2 text-[9px] font-normal normal-case text-slate-300">Select banks where client holds priority status — unlocks lower min. loan thresholds</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                        {[...new Set(packages.map(p => p.bank))].sort().filter(bank =>
                            packages.some(p => p.bank === bank && parsePriorityMin(p.min_loan_note) != null)
                        ).map(bank => (
                            <FilterPill key={bank} active={priorityBanks.has(bank)} color="purple"
                                onClick={() => setPriorityBanks(prev => toggleSet(prev, bank))}>
                                {bank}
                            </FilterPill>
                        ))}
                    </div>
                </div>

                {/* Status bar — only when filters are active */}
                {hasFilters && (
                    <div className="border-t border-slate-100 px-4 py-2.5 flex items-center gap-3 bg-slate-50/60">
                        {parsedLoan && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0277a8] bg-[#03a9e7]/10 px-2.5 py-1 rounded-full">
                                Loan: ${parsedLoan.toLocaleString()}
                            </span>
                        )}
                        {!loading && (
                            <span className="text-[11px] text-slate-400">
                                {filteredPackages.length} package{filteredPackages.length !== 1 ? 's' : ''}
                                {' · '}{columns.length} column{columns.length !== 1 ? 's' : ''}
                                {appealCount > 0 && <span className="text-amber-500 font-medium"> · {appealCount} appeal-eligible</span>}
                            </span>
                        )}
                        <button onClick={clearFilters}
                            className="ml-auto text-[11px] font-medium text-slate-400 hover:text-slate-700 flex items-center gap-1 transition-colors">
                            <X size={12} /> Clear all
                        </button>
                    </div>
                )}
            </div>

            {/* ── Results ──────────────────────────────────────────────── */}
            {loading ? (
                <div className="flex items-center justify-center py-24">
                    <Spinner size="md" color="#03a9e7" label="Loading packages…" />
                </div>

            ) : !hasFilters ? (
                /* No filters yet → prompt */
                <div className="flex flex-col items-center justify-center py-24 select-none">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-5">
                        <Percent size={26} className="text-slate-300" />
                    </div>
                    <p className="text-[15px] font-semibold text-slate-500 mb-1.5">Enter your client&apos;s details to get started</p>
                    <p className="text-sm text-slate-400 max-w-xs text-center leading-relaxed">
                        Add a loan amount or pick a rate type above — packages will appear side-by-side grouped by rate type.
                    </p>
                </div>

            ) : columns.length === 0 ? (
                /* Filters applied, nothing matches */
                <div className="flex flex-col items-center justify-center py-24 select-none">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-5">
                        <Percent size={26} className="text-slate-300" />
                    </div>
                    <p className="text-[15px] font-semibold text-slate-500 mb-1.5">No packages match</p>
                    <p className="text-sm text-slate-400 mb-4">Try loosening the filters or clearing the loan amount.</p>
                    <button onClick={clearFilters}
                        className="text-sm font-medium text-[#03a9e7] hover:underline flex items-center gap-1">
                        <X size={13} /> Clear filters
                    </button>
                </div>

            ) : (
                /* Column layout */
                <div className="overflow-x-auto pb-4 -mx-1 px-1">
                    <div
                        className="flex gap-4 items-start"
                        style={{ minWidth: `${columns.length * 292 + Math.max(0, columns.length - 1) * 16}px` }}
                    >
                        {columns.map(col => (
                            <div key={col.key} className="w-[292px] flex-shrink-0">
                                {/* Column header */}
                                <div className="mb-3 px-0.5">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-bold text-[13px] text-[#052d4a] tracking-tight">{col.label}</span>
                                        <span className="text-[11px] font-medium text-slate-400 tabular-nums">{col.items.length}</span>
                                    </div>
                                    <div className="h-[2px] rounded-full" style={{ background: col.accentHex }} />
                                </div>

                                {/* Cards */}
                                <div className="space-y-3">
                                    {col.items.map(({ pkg, appeal }) => (
                                        <RateCard
                                            key={pkg.id}
                                            pkg={pkg}
                                            sora={sora}
                                            admin={admin}
                                            appeal={appeal}
                                            busy={busyId === pkg.id}
                                            confirming={confirmDelete === pkg.id}
                                            priorityMin={priorityBanks.has(pkg.bank) ? parsePriorityMin(pkg.min_loan_note) : null}
                                            onEdit={() => { setEditing(pkg); setEditorOpen(true) }}
                                            onDuplicate={() => handleDuplicate(pkg.id)}
                                            onPublish={() => handlePublish([pkg.id])}
                                            onAskDelete={() => setConfirmDelete(pkg.id)}
                                            onCancelDelete={() => setConfirmDelete(null)}
                                            onConfirmDelete={() => handleDelete(pkg.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {editorOpen && (
                <RatePackageEditorModal initial={editing} saving={saving}
                    onSave={handleSave} onClose={() => { setEditorOpen(false); setEditing(null) }} />
            )}
            {ingestOpen && (
                <RateIngestionModal
                    onClose={() => setIngestOpen(false)}
                    onDone={() => { setIngestOpen(false); setAlert({ type: 'success', message: 'Packages replaced from sheet.' }); load() }}
                />
            )}
        </div>
    )
}

// ── RateCard ──────────────────────────────────────────────────────────────
// Collapsed: fixed predictable height — bank, name, big rate, 3 chips.
// Expanded: rate schedule, features, subsidies revealed below.

function RateCard({
    pkg, sora, admin, appeal, busy, confirming, priorityMin,
    onEdit, onDuplicate, onPublish, onAskDelete, onCancelDelete, onConfirmDelete,
}: {
    pkg: MortgagePackage
    sora: SoraRates | null
    admin: boolean
    appeal: boolean
    busy: boolean
    confirming: boolean
    priorityMin?: number | null
    onEdit: () => void
    onDuplicate: () => void
    onPublish: () => void
    onAskDelete: () => void
    onCancelDelete: () => void
    onConfirmDelete: () => void
}) {
    const [expanded, setExpanded] = useState(false)
    const head   = headlineRate(pkg.rate_schedule, sora)
    const locked = pkg.lockin_years > 0

    return (
        <div className={`rounded-lg border bg-white transition-all overflow-hidden hover:border-slate-300 ${appeal ? 'border-amber-200' : 'border-slate-200'}`}>
            {/* ── Always-visible section (mirrors the workflow package card) ── */}
            <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#052d4a] truncate flex items-center gap-1.5">
                            {locked ? <Lock size={12} className="text-slate-400 shrink-0" /> : <LockOpen size={12} className="text-slate-400 shrink-0" />}
                            {pkg.bank}
                            {locked ? ` · ${pkg.lockin_years}Y lock-in` : ' · No lock-in'}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{stripBankPrefix(pkg.package_name, pkg.bank)}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {pkg.status === 'draft' && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Draft</span>
                            )}
                            {appeal && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200">Appeal · needs {shortLoan(pkg.min_loan_size)}</span>
                            )}
                            <SmallChip icon={Building2}>{shortPropType(pkg.property_type)}</SmallChip>
                            <SmallChip icon={Wallet}>
                                {priorityMin != null && priorityMin < pkg.min_loan_size
                                    ? <><span className="line-through text-slate-300 mr-1">{shortLoan(pkg.min_loan_size)}</span><span className="text-violet-600 font-semibold">Min {shortLoan(priorityMin)}</span></>
                                    : <>Min {shortLoan(pkg.min_loan_size)}</>
                                }
                            </SmallChip>
                            {(() => {
                                const style = packageStyle(pkg)
                                if (!style) return null
                                return style === 'flexi'
                                    ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#03a9e7] bg-sky-50 border border-[#03a9e7]/30 rounded-full px-1.5 py-0.5 whitespace-nowrap">
                                          <RefreshCcw size={9} className="shrink-0" />Flexi
                                      </span>
                                    : <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-1.5 py-0.5 whitespace-nowrap">
                                          <Lock size={9} className="text-slate-400 shrink-0" />Traditional
                                      </span>
                            })()}
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-base font-bold text-[#03a9e7] tabular-nums leading-none">{head.big}</p>
                        <p className="text-[9px] text-slate-400 mt-1 uppercase tracking-wide">{head.sub}</p>
                    </div>
                </div>
            </div>

            {/* Expand for full package details */}
            <button type="button" onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-slate-400 hover:text-[#03a9e7] border-t border-slate-100">
                {expanded ? 'Hide details' : 'Full package details'} <ChevronDown size={12} className={expanded ? 'rotate-180' : ''} />
            </button>

            {/* ── Expandable section ─────────────────────────────── */}
            {expanded && (
                <div className="px-3 pb-3 pt-2 space-y-3 bg-slate-50/60 border-t border-slate-100">
                    {/* Rate schedule */}
                    <div className="rounded-xl overflow-hidden border border-slate-100 divide-y divide-slate-100 bg-white">
                        {pkg.rate_schedule.map((e, i) => {
                            const yearLabel = e.thereafter ? 'After' : `Y${e.year}`
                            const rateText  = formatRateEntry(e).split(': ').slice(1).join(': ')
                            const { rate }  = e.type === 'floating' ? effectiveRate(e, sora) : { rate: null }
                            const inLockin  = !e.thereafter && typeof e.year === 'number' && e.year <= pkg.lockin_years
                            return (
                                <div key={i} className={`flex items-center justify-between px-3 py-2 text-[11px] ${e.thereafter ? 'bg-slate-50/50' : 'bg-white'}`}>
                                    <span className={`flex items-center gap-1.5 font-medium ${e.thereafter ? 'text-slate-400' : 'text-slate-600'}`}>
                                        {inLockin && <span className="w-1 h-1 rounded-full bg-[#03a9e7] shrink-0" />}
                                        {yearLabel}
                                    </span>
                                    <span className="text-slate-700 tabular-nums text-right">
                                        {rateText}
                                        {rate != null && <span className="text-[#0277a8] ml-1">({rate.toFixed(2)}%)</span>}
                                    </span>
                                </div>
                            )
                        })}
                    </div>

                    {/* Features */}
                    {pkg.features.length > 0 && (
                        <ul className="space-y-1 pt-0.5">
                            {pkg.features.map((f, i) => (
                                <li key={i} className="flex gap-1.5 text-[11px] text-slate-500 leading-snug">
                                    <span className="text-[#03a9e7] shrink-0 mt-0.5">›</span>
                                    <span>{f}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* Subsidies */}
                    {pkg.subsidies && (
                        <p className="text-[11px] text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                            <span className="font-semibold">Subsidy:</span> {pkg.subsidies}
                        </p>
                    )}

                    {/* Min loan note */}
                    {pkg.min_loan_note && (
                        <p className="text-[10px] text-slate-400 italic">{pkg.min_loan_note}</p>
                    )}

                    {/* Admin remarks */}
                    {admin && pkg.remarks && (
                        <p className="text-[10px] text-slate-400 italic border-l-2 border-slate-200 pl-2">
                            {pkg.remarks}
                        </p>
                    )}
                </div>
            )}

            {/* ── Admin footer ─────────────────────────────────────── */}
            {admin && (
                <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-end gap-2">
                    {confirming ? (
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-500">Delete?</span>
                            <button onClick={onConfirmDelete} disabled={busy}
                                className="text-[11px] font-semibold text-red-500 hover:underline">
                                {busy ? '…' : 'Yes'}
                            </button>
                            <button onClick={onCancelDelete} className="text-[11px] text-slate-400 hover:underline">No</button>
                        </div>
                    ) : (
                        <div className="flex items-center">
                            {pkg.status === 'draft' && (
                                <button onClick={onPublish} disabled={busy} title="Publish"
                                    className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-50 rounded-lg mr-1 transition-colors">
                                    <Eye size={11} /> Publish
                                </button>
                            )}
                            <button onClick={onEdit} title="Edit"
                                className="p-1.5 text-slate-300 hover:text-[#03a9e7] hover:bg-slate-50 rounded-lg transition-colors">
                                <Pencil size={12} />
                            </button>
                            <button onClick={onDuplicate} disabled={busy} title="Duplicate"
                                className="p-1.5 text-slate-300 hover:text-[#03a9e7] hover:bg-slate-50 rounded-lg disabled:opacity-40 transition-colors">
                                <Copy size={12} />
                            </button>
                            <button onClick={onAskDelete} title="Delete"
                                className="p-1.5 text-slate-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                                <Trash2 size={12} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ── Small reusable bits ───────────────────────────────────────────────────

function SmallChip({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
    return (
        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-1.5 py-0.5 whitespace-nowrap">
            <Icon size={9} className="text-slate-400 shrink-0" />
            {children}
        </span>
    )
}

function FilterPill({
    children, active, disabled, onClick, color,
}: {
    children: React.ReactNode
    active: boolean
    disabled?: boolean
    onClick: () => void
    color: 'navy' | 'blue' | 'green' | 'purple'
}) {
    const activeClass =
        color === 'navy'   ? 'bg-[#052d4a] text-white border-[#052d4a]' :
        color === 'blue'   ? 'bg-[#03a9e7] text-white border-[#03a9e7]' :
        color === 'purple' ? 'bg-violet-600 text-white border-violet-600' :
                             'bg-emerald-600 text-white border-emerald-600'
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all
                ${active
                    ? activeClass
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'}
                ${disabled ? 'opacity-25 pointer-events-none' : 'cursor-pointer'}`}
        >
            {children}
        </button>
    )
}
