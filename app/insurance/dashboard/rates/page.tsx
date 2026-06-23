'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MortgagePackage, MortgagePackageInput, RateScheduleEntry, RateCategory } from '@/lib/types/rates'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import { effectiveRate } from '@/lib/insurance/rateRecommend'
import RatePackageEditorModal from '@/components/insurance/rates/RatePackageEditorModal'
import RateIngestionModal from '@/components/insurance/rates/RateIngestionModal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import { Percent, Plus, Pencil, Copy, Trash2, Search, Lock, LockOpen, Wallet, Building2, X, ChevronDown, ChevronUp, RefreshCcw, Upload, Eye } from 'lucide-react'
import type { SoraRates } from '@/lib/insurance/sora'

// ── Helpers ───────────────────────────────────────────────────────────────

function headlineRate(schedule: RateScheduleEntry[], sora: SoraRates | null) {
    const first = schedule?.[0]
    if (!first) return { big: '—', sub: '' }
    const { rate } = effectiveRate(first, sora)
    const sub = first.type === 'fixed' ? 'Year 1 · Fixed' : `Year 1 · ${first.reference || 'Floating'}`
    if (rate != null) return { big: `${rate.toFixed(2)}%`, sub }
    return { big: first.spread != null ? `+${first.spread.toFixed(2)}%` : (first.reference || '—'), sub }
}

function shortPropType(pt: string): string {
    const l = pt.toLowerCase()
    if (l.includes('executive')) return 'EC'
    if (pt === 'HDB / Private') return 'HDB / Pvt'
    return pt
}

function shortLoan(n: number): string {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    if (n >= 1_000)     return `$${Math.round(n / 1_000)}k`
    return `$${n}`
}

// ── Filter config ─────────────────────────────────────────────────────────

interface RateTypeOption { key: string; label: string; category: string; lockin: number | null }
const RATE_TYPE_OPTIONS: RateTypeOption[] = [
    { key: '1Y_FIXED',           label: '1 Year Fixed',         category: 'Fixed',                lockin: 1    },
    { key: '2Y_FIXED',           label: '2 Year Fixed',         category: 'Fixed',                lockin: 2    },
    { key: '3Y_FIXED',           label: '3 Year Fixed',         category: 'Fixed',                lockin: 3    },
    { key: '5Y_FIXED',           label: '5 Year Fixed',         category: 'Fixed',                lockin: 5    },
    { key: 'FLOATING_COMPLETED', label: 'Floating (Completed)', category: 'Floating (Completed)', lockin: null },
    { key: 'BUC',                label: 'BUC / BTO',            category: 'BUC',                  lockin: null },
]

const PROPERTY_TYPE_OPTIONS = [
    { value: 'hdb',               label: 'HDB'                          },
    { value: 'bto',               label: 'BTO'                          },
    { value: 'private_completed', label: 'Private (Completed)'          },
    { value: 'private_uc',        label: 'Private (Under Construction)' },
]

const FEATURE_OPTIONS = [
    { key: 'waiver_sale',       label: 'Waiver Due to Sale'          },
    { key: 'partial_repayment', label: 'Partial Repayment'           },
    { key: 'free_conversion',   label: 'Free Conversion (after 12M)' },
]

// ── Column definitions ────────────────────────────────────────────────────

interface ColumnDef {
    key: string; label: string
    accentClass: string   // Tailwind bg-* for card top bar + column underline
    accentHex: string     // Raw hex for inline styles where Tailwind can't arbitrary-escape
    match: (p: MortgagePackage) => boolean
}

const COLUMN_DEFS: ColumnDef[] = [
    { key: '1Y',       label: '1 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && p.lockin_years === 1 },
    { key: '2Y',       label: '2 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && p.lockin_years === 2 },
    { key: '3Y',       label: '3 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && p.lockin_years === 3 },
    { key: '5Y',       label: '5 Year Fixed',   accentClass: 'bg-[#052d4a]', accentHex: '#052d4a', match: p => p.category === 'Fixed' && p.lockin_years === 5 },
    { key: 'OTHFIX',   label: 'Other Fixed',    accentClass: 'bg-slate-500',  accentHex: '#64748b', match: p => p.category === 'Fixed' && ![1,2,3,5].includes(p.lockin_years) },
    { key: 'FLOAT',    label: 'Floating',       accentClass: 'bg-[#03a9e7]', accentHex: '#03a9e7', match: p => p.category === 'Floating (Completed)' },
    { key: 'BUC',      label: 'BUC / BTO',      accentClass: 'bg-amber-500',  accentHex: '#f59e0b', match: p => p.category === 'BUC' },
]

type PropTypeFilter = '' | 'hdb' | 'bto' | 'private_completed' | 'private_uc'

// ── Filter logic ──────────────────────────────────────────────────────────

function isRateTypeDisabled(key: string, propType: PropTypeFilter) {
    if (key === 'BUC' && (propType === 'hdb' || propType === 'private_completed')) return true
    if (key !== 'BUC' && (propType === 'bto' || propType === 'private_uc')) return true
    return false
}

function matchesRateType(pkg: MortgagePackage, rateTypes: Set<string>) {
    if (rateTypes.size === 0) return true
    return RATE_TYPE_OPTIONS.some(o => rateTypes.has(o.key) && pkg.category === o.category && (o.lockin === null || pkg.lockin_years === o.lockin))
}

function matchesPropType(pkg: MortgagePackage, propType: PropTypeFilter) {
    if (!propType) return true
    const pt = pkg.property_type.toLowerCase()
    const isHdb = pt.includes('hdb')
    const isPrivate = pt.includes('private') || pt.includes('executive')
    const isBuc = pkg.category === 'BUC'
    if (propType === 'hdb')               return isHdb && !isBuc
    if (propType === 'bto')               return isHdb && isBuc
    if (propType === 'private_completed') return isPrivate && !isBuc
    if (propType === 'private_uc')        return isPrivate && isBuc
    return true
}

function matchesFeature(pkg: MortgagePackage, features: Set<string>) {
    if (features.size === 0) return true
    const fl = pkg.features.map(f => f.toLowerCase())
    for (const fk of features) {
        const ok = fk === 'waiver_sale'       ? fl.some(f => f.includes('waiver') && (f.includes('sale') || f.includes('sold')))
                 : fk === 'partial_repayment' ? fl.some(f => f.includes('partial'))
                 : fk === 'free_conversion'   ? fl.some(f => f.includes('conversion') || f.includes('convert'))
                 : false
        if (!ok) return false
    }
    return true
}

function applyLoanSizeFilter(pkgs: MortgagePackage[], loan: number): { pkg: MortgagePackage; appeal: boolean }[] {
    const groups = new Map<string, MortgagePackage[]>()
    for (const pkg of pkgs) {
        const key = `${pkg.bank}|${pkg.category}|${pkg.property_type}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(pkg)
    }
    const result: { pkg: MortgagePackage; appeal: boolean }[] = []
    for (const [, group] of groups) {
        const strict = group.filter(p => p.min_loan_size <= loan)
        if (strict.length > 0) {
            const maxTier = Math.max(...strict.map(p => p.min_loan_size))
            strict.filter(p => p.min_loan_size === maxTier).forEach(p => result.push({ pkg: p, appeal: false }))
        }
        // Within 10% above the loan → bank may approve on appeal.
        const VARIANCE = 1 / 0.9
        group.filter(p => p.min_loan_size > loan && p.min_loan_size <= loan * VARIANCE)
            .forEach(p => result.push({ pkg: p, appeal: true }))
    }
    return result
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function RatesPage() {
    const [admin, setAdmin] = useState(false)
    const [packages, setPackages] = useState<MortgagePackage[]>([])
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [refreshingSora, setRefreshingSora] = useState(false)
    const [loading, setLoading] = useState(true)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const [loanSize, setLoanSize]     = useState('')
    const [currentBank, setCurrentBank] = useState('')
    const [propType, setPropType]     = useState<PropTypeFilter>('')
    const [rateTypes, setRateTypes]   = useState<Set<string>>(new Set())
    const [features, setFeatures]     = useState<Set<string>>(new Set())
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
        if (res.ok) { setPackages(json.data ?? []); setAdmin(!!json.isAdmin); setSora(json.sora ?? null) }
        else setAlert({ type: 'error', message: json.error || 'Failed to load packages' })
        setLoading(false)
    }, [])
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

    const hasFilters = !!(loanSize || currentBank || propType || rateTypes.size || features.size || q.trim())

    const clearFilters = () => {
        setLoanSize(''); setCurrentBank(''); setPropType('')
        setRateTypes(new Set()); setFeatures(new Set()); setQ('')
    }

    const filteredPackages = useMemo(() => {
        if (!hasFilters) return []
        let items: { pkg: MortgagePackage; appeal: boolean }[] = parsedLoan
            ? applyLoanSizeFilter(packages, parsedLoan)
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
    }, [packages, parsedLoan, currentBank, propType, rateTypes, features, q, hasFilters])

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
                            Current Bank <span className="normal-case font-normal">(will be excluded)</span>
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
                                            accentClass={col.accentClass}
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
    pkg, sora, admin, appeal, busy, confirming, accentClass,
    onEdit, onDuplicate, onPublish, onAskDelete, onCancelDelete, onConfirmDelete,
}: {
    pkg: MortgagePackage
    sora: SoraRates | null
    admin: boolean
    appeal: boolean
    busy: boolean
    confirming: boolean
    accentClass: string
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
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-150 overflow-hidden">
            {/* 3px top accent */}
            <div className={`h-[3px] ${accentClass}`} />

            <div className="p-4">
                {/* ── Always-visible section ─────────────────────────── */}

                {/* Bank row */}
                <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-bold text-[13px] text-[#052d4a] truncate leading-tight flex-1">
                        {pkg.bank}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                        {pkg.status === 'draft' && (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Draft</span>
                        )}
                        {appeal && (
                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200">Appeal</span>
                        )}
                    </div>
                </div>

                {/* Package name — capped at 2 lines so all cards share ~same baseline */}
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-snug min-h-[32px] mb-3">
                    {pkg.package_name}
                </p>

                {/* Rate — the hero */}
                <div className="mb-4">
                    <p className="text-[34px] font-bold tabular-nums leading-none tracking-tight text-[#052d4a]">
                        {head.big}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-widest font-medium">
                        {head.sub}
                    </p>
                </div>

                {/* 3 key chips — abbreviated to stay on one row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                    <SmallChip icon={Building2}>{shortPropType(pkg.property_type)}</SmallChip>
                    <SmallChip icon={locked ? Lock : LockOpen}>
                        {locked ? `${pkg.lockin_years}Y lock-in` : 'No lock-in'}
                    </SmallChip>
                    <SmallChip icon={Wallet}>Min {shortLoan(pkg.min_loan_size)}</SmallChip>
                </div>

                {/* ── Expandable section ─────────────────────────────── */}
                {expanded && (
                    <div className="mt-4 space-y-3">
                        {/* Rate schedule */}
                        <div className="rounded-xl overflow-hidden border border-slate-100 divide-y divide-slate-100">
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

                {/* ── Footer ─────────────────────────────────────────── */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                        onClick={() => setExpanded(v => !v)}
                        className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-[#03a9e7] transition-colors"
                    >
                        {expanded
                            ? <><ChevronUp size={12} /> Less</>
                            : <><ChevronDown size={12} /> Details</>}
                    </button>

                    {admin && (
                        confirming ? (
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
                        )
                    )}
                </div>
            </div>
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
    color: 'navy' | 'blue' | 'green'
}) {
    const activeClass =
        color === 'navy'  ? 'bg-[#052d4a] text-white border-[#052d4a]' :
        color === 'blue'  ? 'bg-[#03a9e7] text-white border-[#03a9e7]' :
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
