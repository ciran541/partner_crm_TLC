'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MortgagePackage, MortgagePackageInput, RateScheduleEntry, RATE_CATEGORIES, RateCategory } from '@/lib/types/rates'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import RatePackageEditorModal from '@/components/insurance/rates/RatePackageEditorModal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import { Percent, Plus, Pencil, Copy, Trash2, Search, Lock, LockOpen, Wallet, Building2, X, ChevronLeft, ChevronRight } from 'lucide-react'

const CATEGORY_STYLE: Record<RateCategory, string> = {
    'Fixed': 'bg-[#052d4a] text-white',
    'Floating (Completed)': 'bg-[#03a9e7] text-white',
    'BUC': 'bg-amber-500 text-white',
}

// Headline figure for a package: the Year-1 rate, shown big.
function headlineRate(schedule: RateScheduleEntry[]): { big: string; sub: string } {
    const first = schedule?.[0]
    if (!first) return { big: '—', sub: '' }
    if (first.type === 'fixed') {
        return { big: first.rate != null ? `${first.rate.toFixed(2)}%` : '—', sub: 'Year 1 · Fixed' }
    }
    return {
        big: first.spread != null ? `+${first.spread.toFixed(2)}%` : (first.reference || 'SORA'),
        sub: `Year 1 · ${first.reference || 'Floating'}`,
    }
}

export default function RatesPage() {
    const [admin, setAdmin] = useState(false)
    const [packages, setPackages] = useState<MortgagePackage[]>([])
    const [loading, setLoading] = useState(true)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const [bank, setBank] = useState('')
    const [propertyType, setPropertyType] = useState('')
    const [category, setCategory] = useState('')
    const [q, setQ] = useState('')
    const [page, setPage] = useState(1)
    const PAGE_SIZE = 8

    const [editorOpen, setEditorOpen] = useState(false)
    const [editing, setEditing] = useState<MortgagePackage | null>(null)
    const [saving, setSaving] = useState(false)
    const [busyId, setBusyId] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        const params = new URLSearchParams()
        if (bank) params.set('bank', bank)
        if (propertyType) params.set('property_type', propertyType)
        if (category) params.set('category', category)
        if (q.trim()) params.set('q', q.trim())
        const res = await fetch(`/api/insurance/rates?${params.toString()}`)
        const json = await res.json()
        if (res.ok) {
            setPackages(json.data ?? [])
            setAdmin(!!json.isAdmin)
        } else {
            setAlert({ type: 'error', message: json.error || 'Failed to load packages' })
        }
        setLoading(false)
    }, [bank, propertyType, category, q])

    useEffect(() => { load() }, [load])

    const propertyTypes = useMemo(() => [...new Set(packages.map(p => p.property_type))].sort(), [packages])
    const hasFilters = bank || propertyType || category || q.trim()
    const clearFilters = () => { setBank(''); setPropertyType(''); setCategory(''); setQ('') }

    // Pagination over the already-loaded filtered list.
    const pageCount = Math.max(1, Math.ceil(packages.length / PAGE_SIZE))
    const safePage = Math.min(page, pageCount)
    const pageItems = useMemo(
        () => packages.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
        [packages, safePage]
    )
    // Reset to page 1 whenever the result set changes (new filter / reload).
    useEffect(() => { setPage(1) }, [packages])

    const handleSave = async (input: MortgagePackageInput) => {
        setSaving(true)
        try {
            const res = editing
                ? await fetch('/api/admin/rates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id, input }) })
                : await fetch('/api/admin/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Save failed')
            setEditorOpen(false); setEditing(null)
            setAlert({ type: 'success', message: editing ? 'Package updated.' : 'Package added.' })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally { setSaving(false) }
    }

    const handleDuplicate = async (id: string) => {
        setBusyId(id)
        try {
            const res = await fetch('/api/admin/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ duplicateId: id }) })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Duplicate failed')
            setAlert({ type: 'success', message: 'Duplicated as a draft — edit and publish when ready.' })
            await load()
            if (json.data) { setEditing(json.data); setEditorOpen(true) }
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally { setBusyId(null) }
    }

    const handleDelete = async (id: string) => {
        setBusyId(id)
        try {
            const res = await fetch(`/api/admin/rates?id=${id}`, { method: 'DELETE' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Delete failed')
            setConfirmDelete(null)
            setAlert({ type: 'success', message: 'Package deleted.' })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally { setBusyId(null) }
    }

    return (
        <div>
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-[#03a9e7]/10"><Percent size={20} className="text-[#03a9e7]" /></span>
                        Mortgage Packages
                    </h1>
                    <p className="page-subtitle">Live bank packages and rates. {admin ? 'Add, edit, or duplicate to keep them current.' : 'Filter to find the right fit for your client.'}</p>
                </div>
                {admin && (
                    <button onClick={() => { setEditing(null); setEditorOpen(true) }} className="btn-primary px-4 py-2.5 text-sm flex items-center gap-2 shadow-sm">
                        <Plus size={16} /> New Package
                    </button>
                )}
            </div>

            {alert && <div className="mb-4"><InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} /></div>}

            {/* Filter toolbar */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-3 mb-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    <InsuranceBankDropdown value={bank} onChange={setBank} placeholder="All banks" />
                    <select value={propertyType} onChange={e => setPropertyType(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                        <option value="">All property types</option>
                        {propertyTypes.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <select value={category} onChange={e => setCategory(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                        <option value="">All categories</option>
                        {RATE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search package name…"
                            className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                    </div>
                </div>
                {hasFilters && (
                    <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100">
                        <span className="text-xs text-slate-400">{loading ? 'Filtering…' : `${packages.length} match${packages.length !== 1 ? 'es' : ''}`}</span>
                        <button onClick={clearFilters} className="ml-auto text-xs font-medium text-slate-500 hover:text-[#03a9e7] flex items-center gap-1">
                            <X size={13} /> Clear filters
                        </button>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20"><Spinner size="md" color="#03a9e7" label="Loading packages…" /></div>
            ) : packages.length === 0 ? (
                <EmptyState icon={Percent} title="No packages found" description={hasFilters ? 'Try clearing the filters.' : 'No packages have been added yet.'} />
            ) : (
                <>
                    {!hasFilters && <p className="text-xs text-slate-400 mb-3">{packages.length} package{packages.length !== 1 ? 's' : ''}</p>}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {pageItems.map(pkg => (
                            <PackageCard key={pkg.id} pkg={pkg} admin={admin} busy={busyId === pkg.id}
                                confirming={confirmDelete === pkg.id}
                                onEdit={() => { setEditing(pkg); setEditorOpen(true) }}
                                onDuplicate={() => handleDuplicate(pkg.id)}
                                onAskDelete={() => setConfirmDelete(pkg.id)}
                                onCancelDelete={() => setConfirmDelete(null)}
                                onConfirmDelete={() => handleDelete(pkg.id)} />
                        ))}
                    </div>

                    {pageCount > 1 && (
                        <Pagination page={safePage} pageCount={pageCount} onChange={p => {
                            setPage(p)
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                        }} />
                    )}
                </>
            )}

            {editorOpen && (
                <RatePackageEditorModal initial={editing} saving={saving}
                    onSave={handleSave} onClose={() => { setEditorOpen(false); setEditing(null) }} />
            )}
        </div>
    )
}

function PackageCard({ pkg, admin, busy, confirming, onEdit, onDuplicate, onAskDelete, onCancelDelete, onConfirmDelete }: {
    pkg: MortgagePackage
    admin: boolean
    busy: boolean
    confirming: boolean
    onEdit: () => void
    onDuplicate: () => void
    onAskDelete: () => void
    onCancelDelete: () => void
    onConfirmDelete: () => void
}) {
    const head = headlineRate(pkg.rate_schedule)
    const locked = pkg.lockin_years > 0

    return (
        <div className="group bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-[#03a9e7]/40 transition-all overflow-hidden flex flex-col">
            {/* top accent strip */}
            <div className={`h-1 ${pkg.category === 'Fixed' ? 'bg-[#052d4a]' : pkg.category === 'Floating (Completed)' ? 'bg-[#03a9e7]' : 'bg-amber-500'}`} />

            <div className="p-5 flex flex-col flex-1">
                {/* Header: bank + name (left), headline rate (right) */}
                <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-[#052d4a] text-[15px]">{pkg.bank}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_STYLE[pkg.category] ?? 'bg-slate-400 text-white'}`}>{pkg.category}</span>
                            {pkg.status === 'draft' && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">Draft</span>}
                        </div>
                        <p className="text-[13px] text-slate-600 mt-1 leading-snug">{pkg.package_name}</p>
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-2xl font-bold text-[#052d4a] leading-none tabular-nums">{head.big}</p>
                        <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">{head.sub}</p>
                    </div>
                </div>

                {/* Meta chips */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                    <Chip icon={Building2}>{pkg.property_type}</Chip>
                    <Chip icon={locked ? Lock : LockOpen}>{locked ? `${pkg.lockin_years}Y lock-in` : 'No lock-in'}</Chip>
                    <Chip icon={Wallet}>Min ${pkg.min_loan_size.toLocaleString()}</Chip>
                </div>

                {/* Rate timeline */}
                <div className="rounded-xl bg-slate-50 border border-slate-100 divide-y divide-slate-100 mb-3">
                    {pkg.rate_schedule.map((e, i) => {
                        const inLockin = !e.thereafter && typeof e.year === 'number' && e.year <= pkg.lockin_years
                        const [label, ...rest] = formatRateEntry(e).split(': ')
                        return (
                            <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[13px]">
                                <span className={`flex items-center gap-1.5 ${e.thereafter ? 'text-slate-400' : 'text-slate-500'}`}>
                                    {inLockin && <span className="w-1.5 h-1.5 rounded-full bg-[#03a9e7]" title="Within lock-in" />}
                                    {label}
                                </span>
                                <span className="font-medium text-slate-700 tabular-nums">{rest.join(': ')}</span>
                            </div>
                        )
                    })}
                </div>

                {pkg.features.length > 0 && (
                    <ul className="space-y-1 mb-3">
                        {pkg.features.map((f, i) => (
                            <li key={i} className="text-xs text-slate-500 flex gap-1.5"><span className="text-[#03a9e7] mt-0.5 shrink-0">›</span><span>{f}</span></li>
                        ))}
                    </ul>
                )}

                {pkg.subsidies && <p className="text-xs text-emerald-700 mb-1"><span className="font-semibold">Subsidy:</span> {pkg.subsidies}</p>}
                {admin && pkg.remarks && <p className="text-xs text-slate-400 italic mb-1">Note: {pkg.remarks}</p>}

                <div className="mt-auto pt-3 flex items-center justify-between border-t border-slate-100">
                    <span className="text-[11px] text-slate-400">Updated {pkg.last_updated}</span>
                    {admin && (
                        confirming ? (
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500">Delete this package?</span>
                                <button onClick={onConfirmDelete} disabled={busy} className="text-xs font-semibold text-red-600 hover:underline">{busy ? '…' : 'Yes'}</button>
                                <button onClick={onCancelDelete} className="text-xs text-slate-400 hover:underline">No</button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1">
                                <button onClick={onEdit} title="Edit" className="p-1.5 text-slate-400 hover:text-[#03a9e7] hover:bg-slate-100 rounded-lg"><Pencil size={14} /></button>
                                <button onClick={onDuplicate} disabled={busy} title="Duplicate" className="p-1.5 text-slate-400 hover:text-[#03a9e7] hover:bg-slate-100 rounded-lg disabled:opacity-40"><Copy size={14} /></button>
                                <button onClick={onAskDelete} title="Delete" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>
    )
}

function Chip({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
    return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">
            <Icon size={12} className="text-slate-400" />{children}
        </span>
    )
}

function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
    // Build a compact page list with ellipses for long ranges: 1 … 4 5 6 … 12
    const pages: (number | '…')[] = []
    const push = (p: number | '…') => pages.push(p)
    const window = 1 // neighbours on each side of current
    for (let p = 1; p <= pageCount; p++) {
        if (p === 1 || p === pageCount || (p >= page - window && p <= page + window)) push(p)
        else if (pages[pages.length - 1] !== '…') push('…')
    }

    const btn = 'min-w-9 h-9 px-2 rounded-lg text-sm font-medium flex items-center justify-center transition-colors'

    return (
        <nav className="flex items-center justify-center gap-1.5 mt-6" aria-label="Pagination">
            <button onClick={() => onChange(page - 1)} disabled={page === 1}
                className={`${btn} border border-slate-200 text-slate-500 hover:border-[#03a9e7] hover:text-[#03a9e7] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-500`}>
                <ChevronLeft size={16} />
            </button>
            {pages.map((p, i) => p === '…'
                ? <span key={`e${i}`} className="px-1 text-slate-400 select-none">…</span>
                : <button key={p} onClick={() => onChange(p)}
                    className={`${btn} ${p === page ? 'bg-[#052d4a] text-white' : 'border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'}`}>
                    {p}
                </button>
            )}
            <button onClick={() => onChange(page + 1)} disabled={page === pageCount}
                className={`${btn} border border-slate-200 text-slate-500 hover:border-[#03a9e7] hover:text-[#03a9e7] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-500`}>
                <ChevronRight size={16} />
            </button>
        </nav>
    )
}
