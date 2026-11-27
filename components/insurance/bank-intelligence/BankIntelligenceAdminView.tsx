'use client'

import { useEffect, useState } from 'react'
import { Landmark, Trash2, EyeOff, Eye, RefreshCcw, CheckCircle2, XCircle, FileSearch } from 'lucide-react'
import type { BankIntelligenceReport } from '@/lib/types/bankIntelligence'
import { BANK_SOURCES } from '@/lib/types/bankIntelligence'
import ReportReviewModal from '@/components/insurance/bank-intelligence/ReportReviewModal'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { askConfirm } from '@/components/shared/ConfirmDialog'

// Admin QA console. Discovery + extraction are fully automated via the daily
// cron (/api/cron/bank-intelligence) + "Check for new reports" here — this
// view exists to review an AI summary before publishing, hide/delete, and
// re-run extraction on a failure, never as a required data-entry step.
export default function BankIntelligenceAdminView() {
    const [reports, setReports] = useState<BankIntelligenceReport[]>([])
    const [loading, setLoading] = useState(true)
    const [bankFilter, setBankFilter] = useState('')
    const [refreshing, setRefreshing] = useState(false)
    const [reviewing, setReviewing] = useState<BankIntelligenceReport | null>(null)
    const [saving, setSaving] = useState(false)
    const [reExtractingId, setReExtractingId] = useState<string | null>(null)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const load = async () => {
        setLoading(true)
        const res = await fetch('/api/admin/insurance/bank-intelligence')
        const json = await res.json()
        setReports(json.data ?? [])
        setLoading(false)
    }
    useEffect(() => { load() }, [])

    const filtered = bankFilter ? reports.filter(r => r.bank_key === bankFilter) : reports

    const handleRefresh = async () => {
        setRefreshing(true)
        try {
            const res = await fetch('/api/admin/insurance/bank-intelligence/refresh', { method: 'POST' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Refresh failed')
            const more = json.pending > 0 ? ` ${json.pending} still waiting for a summary — click again to continue (or the daily run will).` : ''
            setAlert({ type: 'success', message: `Checked — ${json.inserted} new report${json.inserted === 1 ? '' : 's'} found, ${json.extracted} summarized.${more}` })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setRefreshing(false)
        }
    }

    const handleToggleHidden = async (r: BankIntelligenceReport) => {
        const res = await fetch('/api/admin/insurance/bank-intelligence', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id, hidden: !r.hidden }),
        })
        if (res.ok) await load()
        else setAlert({ type: 'error', message: 'Update failed.' })
    }

    const handleTogglePublished = async (r: BankIntelligenceReport) => {
        const res = await fetch('/api/admin/insurance/bank-intelligence', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id, isPublished: !r.is_published }),
        })
        if (res.ok) await load()
        else setAlert({ type: 'error', message: 'Update failed.' })
    }

    const handleDelete = async (r: BankIntelligenceReport) => {
        if (!(await askConfirm({ title: `Delete "${r.title}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' }))) return
        const res = await fetch(`/api/admin/insurance/bank-intelligence?id=${r.id}`, { method: 'DELETE' })
        if (res.ok) { setAlert({ type: 'success', message: 'Report deleted.' }); await load() }
        else setAlert({ type: 'error', message: 'Delete failed.' })
    }

    const handleSaveReview = async (summary: string, publish: boolean) => {
        if (!reviewing) return
        setSaving(true)
        try {
            const res = await fetch('/api/admin/insurance/bank-intelligence', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: reviewing.id, summary, isPublished: publish }),
            })
            if (!res.ok) throw new Error('Save failed')
            setAlert({ type: 'success', message: publish ? 'Saved and published.' : 'Draft saved.' })
            setReviewing(null)
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setSaving(false)
        }
    }

    const handleReExtract = async () => {
        if (!reviewing) return
        setReExtractingId(reviewing.id)
        try {
            const res = await fetch('/api/admin/insurance/bank-intelligence', {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: reviewing.id, reExtract: true }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Extraction failed')
            const refreshed = await fetch('/api/admin/insurance/bank-intelligence').then(r => r.json())
            const updated = (refreshed.data ?? []).find((r: BankIntelligenceReport) => r.id === reviewing.id)
            if (updated) setReviewing(updated)
            setReports(refreshed.data ?? [])
            setAlert({ type: 'success', message: 'Extraction re-run.' })
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setReExtractingId(null)
        }
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <Landmark size={24} className="text-[#03a9e7]" /> Banks&apos; Insights
                    </h1>
                    <p className="page-subtitle">Auto-discovered reports from OCBC, UOB, HSBC, Maybank, SC and DBS, summarized by AI. Review a summary before publishing — nothing reaches agents until you do.</p>
                </div>
                <button onClick={handleRefresh} disabled={refreshing} title="Check each bank's research page for a new report"
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors flex items-center gap-2 disabled:opacity-50">
                    {refreshing ? <Spinner size="sm" color="#64748b" /> : <RefreshCcw size={15} />}
                    Check for new reports
                </button>
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            <div className="flex gap-3 flex-wrap">
                <select value={bankFilter} onChange={e => setBankFilter(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                    <option value="">All banks</option>
                    {BANK_SOURCES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
            </div>

            {loading ? (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2].map(i => <Skeleton key={i} height={44} radius={10} />)}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={Landmark}
                    iconColor="#03a9e7"
                    title={bankFilter ? 'No reports match' : 'No reports yet'}
                    description={bankFilter ? 'Try a different bank filter.' : 'Click "Check for new reports" to run the first discovery, or wait for the daily cron.'}
                />
            ) : (
                <div className="card overflow-hidden">
                    <div className="table-scroll">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                                <th className="px-4 py-3 font-semibold">Report</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Bank</th>
                                <th className="px-4 py-3 font-semibold hidden md:table-cell">Published</th>
                                <th className="px-4 py-3 font-semibold">Status</th>
                                <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(r => (
                                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                    <td className="px-4 py-3">
                                        <button onClick={() => setReviewing(r)} className="font-medium text-slate-800 hover:text-[#03a9e7] line-clamp-1 text-left">
                                            {r.title}
                                        </button>
                                        {r.series && <p className="text-xs text-slate-500">{r.series}</p>}
                                        {r.extraction_error && <p className="text-xs text-red-500 line-clamp-1">Extraction failed</p>}
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell">
                                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{r.bank}</span>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">{r.published_date ? new Date(r.published_date).toLocaleDateString() : '—'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                            r.hidden ? 'bg-slate-100 text-slate-500'
                                            : r.is_published ? 'bg-emerald-50 text-emerald-700'
                                            : r.summary ? 'bg-amber-50 text-amber-700'
                                            : 'bg-red-50 text-red-600'
                                        }`}>
                                            {r.hidden ? 'Hidden' : r.is_published ? 'Published' : r.summary ? 'Draft — needs review' : 'Not yet summarized'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1 justify-end">
                                            <button onClick={() => setReviewing(r)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Review summary">
                                                <FileSearch size={15} />
                                            </button>
                                            <button onClick={() => handleTogglePublished(r)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title={r.is_published ? 'Unpublish' : 'Publish'} disabled={!r.summary}>
                                                {r.is_published ? <XCircle size={15} /> : <CheckCircle2 size={15} className={!r.summary ? 'opacity-30' : ''} />}
                                            </button>
                                            <button onClick={() => handleToggleHidden(r)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title={r.hidden ? 'Unhide' : 'Hide'}>
                                                {r.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                                            </button>
                                            <button onClick={() => handleDelete(r)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}

            {reviewing && (
                <ReportReviewModal
                    report={reviewing}
                    saving={saving}
                    reExtracting={reExtractingId === reviewing.id}
                    onSave={handleSaveReview}
                    onReExtract={handleReExtract}
                    onClose={() => setReviewing(null)}
                />
            )}
        </div>
    )
}
