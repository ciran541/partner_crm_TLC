'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { isAdmin } from '@/lib/permissions'
import { KnowledgeArticle, KnowledgeArticleInput, KNOWLEDGE_CATEGORIES } from '@/lib/types/knowledge'
import KnowledgeAsk from '@/components/insurance/knowledge/KnowledgeAsk'
import KnowledgeEditorModal from '@/components/insurance/knowledge/KnowledgeEditorModal'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { BookOpen, Plus, Pencil, Trash2, Search, RefreshCcw, HelpCircle } from 'lucide-react'

export default function KnowledgePage() {
    const [role, setRole] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
            setRole(profile?.role ?? 'agent')
            setLoading(false)
        }
        load()
    }, [])

    if (loading) return (
        <div className="flex items-center justify-center py-20"><Spinner size="md" color="#03a9e7" label="Loading…" /></div>
    )

    return isAdmin(role as any) ? <AdminRepository /> : <AgentSearchView />
}

// ─── Agent view: search only, never a full list ───────────────────────────────

function AgentSearchView() {
    return (
        <div className="max-w-2xl mx-auto space-y-5">
            <div>
                <h1 className="ios-page-title flex items-center gap-2">
                    <BookOpen size={24} className="text-[#03a9e7]" /> Knowledge
                </h1>
                <p className="page-subtitle">Ask anything about the mortgage process — you&apos;ll get a direct answer from TLC&apos;s playbook.</p>
            </div>
            <div className="card p-5">
                <KnowledgeAsk autoFocus />
            </div>
        </div>
    )
}

// ─── Admin view: full repository manager ───────────────────────────────────────

function AdminRepository() {
    const [articles, setArticles] = useState<KnowledgeArticle[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [categoryFilter, setCategoryFilter] = useState('')
    const [editorOpen, setEditorOpen] = useState(false)
    const [editing, setEditing] = useState<KnowledgeArticle | null>(null)
    const [saving, setSaving] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const [gaps, setGaps] = useState<{ question: string; count: number; lastAsked: string; ids: string[] }[]>([])
    const [seedTitle, setSeedTitle] = useState('')

    const load = async () => {
        setLoading(true)
        const [aRes, gRes] = await Promise.all([
            fetch('/api/admin/knowledge'),
            fetch('/api/admin/knowledge/gaps'),
        ])
        const aJson = await aRes.json()
        setArticles(aJson.data ?? [])
        try { const gJson = await gRes.json(); setGaps(gJson.data ?? []) } catch { setGaps([]) }
        setLoading(false)
    }
    useEffect(() => { load() }, [])

    const dismissGap = async (ids: string[]) => {
        const res = await fetch('/api/admin/knowledge/gaps/resolve', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
        })
        if (res.ok) setGaps(prev => prev.filter(g => g.ids[0] !== ids[0]))
    }

    const writeFromGap = (question: string) => {
        setSeedTitle(question)
        setEditing(null)
        setEditorOpen(true)
    }

    const filtered = articles.filter(a => {
        if (categoryFilter && a.category !== categoryFilter) return false
        if (search) {
            const s = search.toLowerCase()
            return a.title.toLowerCase().includes(s) || a.content.toLowerCase().includes(s) || a.tags.some(t => t.toLowerCase().includes(s))
        }
        return true
    })

    const handleSave = async (input: KnowledgeArticleInput) => {
        setSaving(true)
        try {
            const url = editing ? '/api/admin/knowledge/update' : '/api/admin/knowledge/create'
            const body = editing ? { id: editing.id, updates: input } : input
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Save failed') }
            setEditorOpen(false); setEditing(null)
            setAlert({ type: 'success', message: editing ? 'Article updated.' : 'Article created.' })
            await load()
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (a: KnowledgeArticle) => {
        if (!confirm(`Delete "${a.title}"? This cannot be undone.`)) return
        const res = await fetch('/api/admin/knowledge/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }) })
        if (res.ok) { setAlert({ type: 'success', message: 'Article deleted.' }); await load() }
        else setAlert({ type: 'error', message: 'Delete failed.' })
    }

    const [reindexing, setReindexing] = useState(false)
    const handleReindex = async () => {
        setReindexing(true)
        try {
            const res = await fetch('/api/admin/knowledge/reindex?all=true', { method: 'POST' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Reindex failed')
            setAlert({ type: 'success', message: `Embeddings rebuilt: ${json.embedded} indexed${json.failed ? `, ${json.failed} failed` : ''}.` })
        } catch (e: any) {
            setAlert({ type: 'error', message: e.message })
        } finally {
            setReindexing(false)
        }
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2">
                        <BookOpen size={24} className="text-[#03a9e7]" /> Knowledge Repository
                    </h1>
                    <p className="page-subtitle">The master library. Agents only see this via contextual surfacing and search.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={handleReindex} disabled={reindexing} title="Rebuild semantic search embeddings for all articles"
                        className="px-3 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors flex items-center gap-2 disabled:opacity-50">
                        {reindexing ? <Spinner size="sm" color="#64748b" /> : <RefreshCcw size={15} />}
                        Reindex
                    </button>
                    <button onClick={() => { setEditing(null); setEditorOpen(true) }} className="btn-primary px-4 py-2 text-sm flex items-center gap-2">
                        <Plus size={16} /> New Article
                    </button>
                </div>
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            {/* Knowledge gaps — questions agents asked that we couldn't answer */}
            <div className={`rounded-xl border p-4 ${gaps.length > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-slate-50/60'}`}>
                <div className="flex items-center gap-2 mb-1">
                    <HelpCircle size={16} className={gaps.length > 0 ? 'text-amber-600' : 'text-slate-400'} />
                    <p className={`text-sm font-bold ${gaps.length > 0 ? 'text-amber-800' : 'text-slate-600'}`}>Knowledge gaps ({gaps.length})</p>
                </div>
                {gaps.length === 0 ? (
                    <p className="text-xs text-slate-400">No gaps yet — agents are finding answers. Questions the knowledge base can&apos;t answer will appear here so you know what to write next.</p>
                ) : (
                    <>
                        <p className="text-xs text-amber-700 mb-3">Agents asked these and we had no answer. Write an article to fill the gap.</p>
                        <div className="space-y-2">
                            {gaps.map(g => (
                                <div key={g.ids[0]} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-amber-100 px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="text-sm text-slate-800 truncate">{g.question}</p>
                                        <p className="text-[11px] text-slate-400">asked {g.count}× · last {new Date(g.lastAsked).toLocaleDateString()}</p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button onClick={() => writeFromGap(g.question)} className="text-xs font-semibold text-[#03a9e7] hover:text-[#0284c7] px-2 py-1">
                                            Write article
                                        </button>
                                        <button onClick={() => dismissGap(g.ids)} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1">
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter articles…"
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                </div>
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                    className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7]">
                    <option value="">All categories</option>
                    {KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            {loading ? (
                <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={44} radius={10} />)}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState
                    icon={BookOpen}
                    iconColor="#03a9e7"
                    title={search || categoryFilter ? 'No articles match' : 'No articles yet'}
                    description={search || categoryFilter ? 'Try a different search term or category filter.' : 'Create your first knowledge article to get started.'}
                    action={search || categoryFilter ? undefined : { label: '+ New Article', onClick: () => { setEditing(null); setEditorOpen(true) } }}
                />
            ) : (
                <div className="card overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-100 text-left text-xs text-slate-400 uppercase tracking-wide">
                                <th className="px-4 py-3 font-semibold">Title</th>
                                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Category</th>
                                <th className="px-4 py-3 font-semibold hidden md:table-cell">Steps</th>
                                <th className="px-4 py-3 font-semibold">Status</th>
                                <th className="px-4 py-3 font-semibold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(a => (
                                <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                                    <td className="px-4 py-3">
                                        <p className="font-medium text-slate-800">{a.title}</p>
                                        <p className="text-xs text-slate-400 line-clamp-1">{a.content.slice(0, 80)}</p>
                                    </td>
                                    <td className="px-4 py-3 hidden sm:table-cell">
                                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{a.category}</span>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell text-xs text-slate-500">{a.step_keys?.length ? a.step_keys.length : '—'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${a.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {a.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1 justify-end">
                                            <button onClick={() => { setEditing(a); setEditorOpen(true) }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Edit"><Pencil size={15} /></button>
                                            <button onClick={() => handleDelete(a)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Delete"><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {editorOpen && (
                <KnowledgeEditorModal
                    initial={editing}
                    seedTitle={!editing ? seedTitle : ''}
                    saving={saving}
                    onSave={handleSave}
                    onClose={() => { setEditorOpen(false); setEditing(null); setSeedTitle('') }}
                />
            )}
        </div>
    )
}
