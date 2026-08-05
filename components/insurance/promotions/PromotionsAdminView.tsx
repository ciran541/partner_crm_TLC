'use client'

import { useEffect, useState } from 'react'
import { Gift, Plus, Trash2, Pencil, Sparkles, Users, Eye, EyeOff, Search, AlertTriangle } from 'lucide-react'
import type { BankPromotion, BankPromotionInput } from '@/lib/types/promotions'
import { WINDOW_BASIS_LABELS } from '@/lib/types/promotions'
import { todaySgt, daysRemaining, isActive, isUpcoming, formatBenefit } from '@/lib/insurance/promotions'
import PromotionEditorModal from './PromotionEditorModal'
import PromotionIngestionModal from './PromotionIngestionModal'
import InlineAlert from '@/components/shared/InlineAlert'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'

const fmtDate = (iso: string | null) =>
    iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '—'

/** Live / Ends in Nd / Upcoming / Expired / Draft — the state an admin scans for. */
function StatusChip({ p, today }: { p: BankPromotion; today: string }) {
    if (p.status !== 'published') {
        return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Draft</span>
    }
    if (isUpcoming(p, today)) {
        return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">Upcoming</span>
    }
    if (!isActive(p, today)) {
        return <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">Expired</span>
    }
    const left = daysRemaining(p, today)
    const urgent = left != null && left <= 3
    return (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${urgent ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
            {left == null ? 'Live' : left === 0 ? 'Ends today' : `${left}d left`}
        </span>
    )
}

/**
 * Admin console for bank promotions.
 *
 * Unlike the news console, this one IS the data-entry path — there is no cron
 * that discovers promotions, because they arrive as a message to a person. The
 * "Import from message" button is the intended route; "Add manually" is the
 * fallback for anything the extractor mangles.
 */
export default function PromotionsAdminView() {
    const [promos, setPromos] = useState<BankPromotion[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [showExpired, setShowExpired] = useState(false)
    const [ingestOpen, setIngestOpen] = useState(false)
    const [editing, setEditing] = useState<BankPromotion | null>(null)
    const [addingNew, setAddingNew] = useState(false)
    const [saving, setSaving] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const today = todaySgt()

    const load = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/admin/insurance/promotions')
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Failed to load promotions')
            setPromos(json.data ?? [])
        } catch (e) {
            setAlert({ type: 'error', message: e instanceof Error ? e.message : 'Failed to load promotions' })
        } finally {
            setLoading(false)
        }
    }
    useEffect(() => { load() }, [])

    const filtered = promos.filter(p => {
        if (!showExpired && p.status === 'published' && !isActive(p, today) && !isUpcoming(p, today)) return false
        if (search) {
            const q = search.toLowerCase()
            return p.bank.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)
        }
        return true
    })
    const expiredCount = promos.filter(p => p.status === 'published' && !isActive(p, today) && !isUpcoming(p, today)).length

    const handleSave = async (input: BankPromotionInput) => {
        setSaving(true)
        try {
            const res = await fetch('/api/admin/insurance/promotions', {
                method: editing ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editing ? { id: editing.id, input } : { input }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Save failed')
            setEditing(null); setAddingNew(false)
            setAlert({ type: 'success', message: 'Promotion saved.' })
            await load()
        } catch (e) {
            setAlert({ type: 'error', message: e instanceof Error ? e.message : 'Save failed' })
        } finally {
            setSaving(false)
        }
    }

    const togglePublish = async (p: BankPromotion) => {
        const res = await fetch('/api/admin/insurance/promotions', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: p.id, status: p.status === 'published' ? 'draft' : 'published' }),
        })
        if (res.ok) await load()
        else setAlert({ type: 'error', message: 'Update failed.' })
    }

    const handleDelete = async (p: BankPromotion) => {
        if (!confirm(`Delete "${p.bank} · ${p.title}"? This cannot be undone.`)) return
        const res = await fetch(`/api/admin/insurance/promotions?id=${p.id}`, { method: 'DELETE' })
        if (res.ok) { setAlert({ type: 'success', message: 'Promotion deleted.' }); await load() }
        else setAlert({ type: 'error', message: 'Delete failed.' })
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <Gift size={24} className="text-amber-500" /> Bank Promotions
                    </h1>
                    <p className="page-subtitle">
                        Time-boxed bank campaigns — client cash rebates and agent referral incentives. Paste a bank&apos;s message and the extractor structures it; you confirm before agents see it. Expired promotions disappear from agents&apos; screens on their own.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setAddingNew(true)}
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors flex items-center gap-2">
                        <Plus size={15} /> Add manually
                    </button>
                    <button onClick={() => setIngestOpen(true)} className="btn-primary px-4 py-2 text-sm flex items-center gap-2">
                        <Sparkles size={16} /> Import from message
                    </button>
                </div>
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            <div className="flex gap-3 flex-wrap items-center">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter by bank or title…"
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                </div>
                {expiredCount > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer whitespace-nowrap">
                        <input type="checkbox" checked={showExpired} onChange={e => setShowExpired(e.target.checked)} className="accent-[#03a9e7]" />
                        Show {expiredCount} expired
                    </label>
                )}
            </div>

            {loading ? (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2].map(i => <Skeleton key={i} height={44} radius={10} />)}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={Gift}
                    iconColor="#f59e0b"
                    title={search ? 'No promotions match' : 'No promotions yet'}
                    description={search ? 'Try a different bank or title.' : 'When a bank sends a promo blast, click "Import from message" and paste it in.'}
                />
            ) : (
                <div className="card overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                                <th className="px-4 py-3 font-semibold">Promotion</th>
                                <th className="px-4 py-3 font-semibold hidden md:table-cell">Benefit</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Window</th>
                                <th className="px-4 py-3 font-semibold">Status</th>
                                <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(p => {
                                const agentOnly = p.audience === 'agent'
                                return (
                                    <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50 align-top">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-slate-800">{p.bank}</span>
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                                    agentOnly ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-800'}`}>
                                                    {agentOnly ? <><Users size={9} /> Agent</> : <><Gift size={9} /> Client</>}
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-0.5">{p.title}</p>
                                            {p.affects_ltv && (
                                                <p className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1">
                                                    <AlertTriangle size={10} /> Affects LTV
                                                </p>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-600 tabular-nums">
                                            {formatBenefit(p)}
                                            {p.clawback_years != null && <span className="block text-[11px] text-slate-400">{p.clawback_years}y clawback</span>}
                                        </td>
                                        <td className="px-4 py-3 hidden sm:table-cell text-xs text-slate-500">
                                            {fmtDate(p.starts_on)} → {fmtDate(p.ends_on)}
                                            <span className="block text-[11px] text-slate-400">{WINDOW_BASIS_LABELS[p.window_basis]?.replace(' by', '')}</span>
                                        </td>
                                        <td className="px-4 py-3"><StatusChip p={p} today={today} /></td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-1 justify-end">
                                                <button onClick={() => togglePublish(p)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                                                    title={p.status === 'published' ? 'Unpublish (hide from agents)' : 'Publish to agents'}>
                                                    {p.status === 'published' ? <EyeOff size={15} /> : <Eye size={15} />}
                                                </button>
                                                <button onClick={() => setEditing(p)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Edit"><Pencil size={15} /></button>
                                                <button onClick={() => handleDelete(p)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={15} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {ingestOpen && (
                <PromotionIngestionModal
                    onClose={() => setIngestOpen(false)}
                    onDone={async () => { setIngestOpen(false); setAlert({ type: 'success', message: 'Promotions saved.' }); await load() }}
                />
            )}
            {(addingNew || editing) && (
                <PromotionEditorModal
                    initial={editing}
                    saving={saving}
                    onSave={handleSave}
                    onClose={() => { setEditing(null); setAddingNew(false) }}
                />
            )}
        </div>
    )
}
