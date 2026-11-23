'use client'

import { useEffect, useState } from 'react'
import { Newspaper, Plus, Trash2, EyeOff, Eye, RefreshCcw, Search, CheckCircle2, XCircle } from 'lucide-react'
import { NewsArticle, NewsArticleInput, NEWS_SOURCES, safeHttpUrl } from '@/lib/types/news'
import NewsArticleModal from '@/components/insurance/news/NewsArticleModal'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { usePagedNews, LoadMoreButton } from '@/components/insurance/news/usePagedNews'

// Admin QA console. Ingestion is fully automated via the daily cron
// (/api/cron/news) + "Refresh now" here — this view is for hiding bad
// articles, deleting, and one-off manual adds, never a required data-entry step.
const PAGE_SIZE = 25

const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: '', label: 'All statuses' },
    { value: 'relevant', label: 'Relevant' },
    { value: 'not_relevant', label: 'Not relevant' },
    { value: 'unclassified', label: 'Unclassified' },
    { value: 'hidden', label: 'Hidden' },
]

export default function NewsAdminView() {
    const [search, setSearch] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [sourceFilter, setSourceFilter] = useState('')
    const [statusFilter, setStatusFilter] = useState('')
    const [modalOpen, setModalOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    // Search runs on the server now, so wait for a pause in typing rather than
    // firing a request per keystroke.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
        return () => clearTimeout(t)
    }, [search])

    const list = usePagedNews('/api/admin/insurance/news', {
        source: sourceFilter || undefined,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
    }, PAGE_SIZE)
    const filtered = list.rows
    const load = list.reload

    // Row actions patch the loaded row in place instead of re-fetching every page
    // the admin has already scrolled through (and losing their place).
    const patchRow = (id: string, patch: Partial<NewsArticle>) =>
        list.setRows(rows => rows.map(r => r.id === id ? { ...r, ...patch } : r))

    const handleRefresh = async () => {
        setRefreshing(true)
        try {
            const res = await fetch('/api/admin/insurance/news/refresh', { method: 'POST' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Refresh failed')
            setAlert({ type: 'success', message: `Refreshed — ${json.inserted} new article${json.inserted === 1 ? '' : 's'} ingested.` })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setRefreshing(false)
        }
    }

    const handleToggleHidden = async (a: NewsArticle) => {
        const res = await fetch('/api/admin/insurance/news', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: a.id, hidden: !a.hidden }),
        })
        if (res.ok) patchRow(a.id, { hidden: !a.hidden })
        else setAlert({ type: 'error', message: 'Update failed.' })
    }

    // Fixes a wrong or missed AI relevance call without deleting + retyping the article.
    const handleToggleRelevant = async (a: NewsArticle) => {
        const res = await fetch('/api/admin/insurance/news', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: a.id, isRelevant: a.is_relevant !== true }),
        })
        if (res.ok) patchRow(a.id, { is_relevant: a.is_relevant !== true, relevance_reason: 'Manually overridden by admin' })
        else setAlert({ type: 'error', message: 'Update failed.' })
    }

    const handleDelete = async (a: NewsArticle) => {
        if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return
        const res = await fetch(`/api/admin/insurance/news?id=${a.id}`, { method: 'DELETE' })
        if (res.ok) {
            setAlert({ type: 'success', message: 'Article deleted.' })
            list.setRows(rows => rows.filter(r => r.id !== a.id))
            list.setTotal(t => Math.max(0, t - 1))
        }
        else setAlert({ type: 'error', message: 'Delete failed.' })
    }

    const handleSave = async (input: NewsArticleInput) => {
        setSaving(true)
        try {
            const res = await fetch('/api/admin/insurance/news', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }),
            })
            if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Save failed') }
            setModalOpen(false)
            setAlert({ type: 'success', message: 'Article added.' })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <Newspaper size={24} className="text-[#03a9e7]" /> Mortgage News
                    </h1>
                    <p className="page-subtitle">Auto-ingested daily from Business Times, CNA, Financial Times, The Edge Singapore, MAS, URA and HDB. Hide/delete for QA, or override a wrong AI relevance call — the feed itself needs no manual upkeep.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleRefresh} disabled={refreshing} title="Fetch new articles now"
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors flex items-center gap-2 disabled:opacity-50">
                        {refreshing ? <Spinner size="sm" color="#64748b" /> : <RefreshCcw size={15} />}
                        Refresh now
                    </button>
                    <button onClick={() => setModalOpen(true)} className="btn-primary px-4 py-2 text-sm flex items-center gap-2">
                        <Plus size={16} /> Add Article
                    </button>
                </div>
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter articles…"
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                </div>
                <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                    <option value="">All sources</option>
                    {NEWS_SOURCES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
            </div>

            {!list.loading && list.total > 0 && (
                <p className="text-xs text-slate-400 -mt-2">Showing {filtered.length} of {list.total} article{list.total === 1 ? '' : 's'}</p>
            )}

            {list.error && filtered.length === 0 ? (
                <div className="card text-center py-12 text-sm text-red-500">{list.error}</div>
            ) : list.loading ? (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={44} radius={10} />)}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={Newspaper}
                    iconColor="#03a9e7"
                    title={debouncedSearch || sourceFilter || statusFilter ? 'No articles match' : 'No articles yet'}
                    description={debouncedSearch || sourceFilter || statusFilter ? 'Try a different search term, source or status filter.' : 'Click "Refresh now" to run the first ingestion, or wait for the daily cron.'}
                />
            ) : (
                <div className="card overflow-hidden">
                    <div className="table-scroll">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                                <th className="px-4 py-3 font-semibold">Title</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Source</th>
                                <th className="px-4 py-3 font-semibold hidden md:table-cell">Published</th>
                                <th className="px-4 py-3 font-semibold">Status</th>
                                <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(a => (
                                <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                    <td className="px-4 py-3">
                                        {safeHttpUrl(a.url) ? (
                                            <a href={safeHttpUrl(a.url)!} target="_blank" rel="noopener noreferrer" className="font-medium text-slate-800 hover:text-[#03a9e7] line-clamp-1">{a.title}</a>
                                        ) : (
                                            <span className="font-medium text-slate-800 line-clamp-1">{a.title}</span>
                                        )}
                                        {a.relevance_reason && <p className="text-xs text-slate-400 line-clamp-1">{a.relevance_reason}</p>}
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell">
                                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{a.source}</span>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">{new Date(a.published_at).toLocaleDateString()}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                            a.hidden ? 'bg-slate-100 text-slate-500'
                                            : a.is_relevant === true ? 'bg-emerald-50 text-emerald-700'
                                            : a.is_relevant === false ? 'bg-red-50 text-red-600'
                                            : 'bg-amber-50 text-amber-700'
                                        }`}>
                                            {a.hidden ? 'Hidden' : a.is_relevant === true ? 'Relevant' : a.is_relevant === false ? 'Not relevant' : 'Unclassified'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1 justify-end">
                                            <button onClick={() => handleToggleRelevant(a)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title={a.is_relevant === true ? 'Mark not relevant' : 'Mark relevant (fixes a wrong/missed AI call)'}>
                                                {a.is_relevant === true ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
                                            </button>
                                            <button onClick={() => handleToggleHidden(a)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title={a.hidden ? 'Unhide' : 'Hide'}>
                                                {a.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
                                            </button>
                                            <button onClick={() => handleDelete(a)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}

            {!list.loading && filtered.length > 0 && (
                <>
                    <LoadMoreButton remaining={list.total - filtered.length} loading={list.loadingMore} onClick={list.loadMore} />
                    {list.error && <p className="text-xs text-red-500 text-center">{list.error}</p>}
                </>
            )}

            {modalOpen && (
                <NewsArticleModal saving={saving} onSave={handleSave} onClose={() => setModalOpen(false)} />
            )}
        </div>
    )
}
