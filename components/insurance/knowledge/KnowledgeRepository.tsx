'use client'

import { useEffect, useState } from 'react'
import { KnowledgeArticle, KnowledgeArticleInput } from '@/lib/types/knowledge'
import type { QuestionGroup } from '@/lib/insurance/knowledgeQuestions'
import { CheckAnswers, NotCovered } from '@/components/insurance/knowledge/KnowledgeQuestions'
import KnowledgeEditorModal from '@/components/insurance/knowledge/KnowledgeEditorModal'
import OfficialSources from '@/components/insurance/knowledge/OfficialSources'
import CalculatorGuide from '@/components/insurance/knowledge/CalculatorGuide'
import type { CalcKind } from '@/lib/insurance/knowledgeCalc'
import DraftReview from '@/components/insurance/knowledge/DraftReview'
import KnowledgeWorkList, { ArticleMeta } from '@/components/insurance/knowledge/KnowledgeWorkList'
import { officialName } from '@/lib/insurance/officialName'
import InlineAlert from '@/components/shared/InlineAlert'
import Skeleton from '@/components/shared/Skeleton'
import EmptyState from '@/components/shared/EmptyState'
import { BookOpen, CircleAlert, Plus, Search, Trash2 } from 'lucide-react'
import { askConfirm } from '@/components/shared/ConfirmDialog'

interface EditorGap { question: string; ids: string[]; answer?: string | null; source?: string; addWording: boolean }
type Tab = 'gaps' | 'check' | 'review' | 'articles' | 'official' | 'calculators'
type Queue = 'publish' | 'check'

const PAGE = 25

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)

/** Admin: what agents asked, which answers need checking, and the articles. */
export default function KnowledgeRepository() {
    const [articles, setArticles] = useState<KnowledgeArticle[]>([])
    const [gaps, setGaps] = useState<QuestionGroup[]>([])
    const [loading, setLoading] = useState(true)
    const [loadFailed, setLoadFailed] = useState(false)
    const [picked, setPicked] = useState<Tab | null>(null)
    const [search, setSearch] = useState('')
    // Where an article comes from: 'all', an agency ("IRAS"), 'other' (TLC's own, with a source) or 'none'.
    const [origin, setOrigin] = useState('all')
    const [queue, setQueue] = useState<Queue>('publish')
    // Opened from a changed official page: which calculator to show.
    const [calcFocus, setCalcFocus] = useState<CalcKind | null>(null)
    const [shown, setShown] = useState(PAGE)
    const [editor, setEditor] = useState<{ article: KnowledgeArticle | null; gap: EditorGap | null } | null>(null)
    const [saving, setSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [reindexing, setReindexing] = useState(false)
    // Review tab → the review screen, one at a time. Articles tab → the full editor.
    const [reviewing, setReviewing] = useState<KnowledgeArticle[] | null>(null)

    const load = async () => {
        try {
            const [a, g] = await Promise.all([fetch('/api/admin/knowledge'), fetch('/api/admin/knowledge/gaps')])
            if (!a.ok || !g.ok) throw new Error()
            setArticles((await a.json()).data ?? [])
            setGaps((await g.json()).data ?? [])
            setLoadFailed(false)
        } catch { setLoadFailed(true) }
        setLoading(false)
    }
    useEffect(() => { load() }, [])

    const notCovered = gaps.filter(g => g.kind === 'gap')
    const toCheck = gaps.filter(g => g.kind !== 'gap')
    const tab: Tab = picked ?? (toCheck.some(g => g.down) ? 'check' : notCovered.length ? 'gaps' : toCheck.length ? 'check' : 'articles')
    const published = articles.filter(a => a.status === 'published')
    const checked = published.filter(a => a.checked_on).length
    // The two work queues: drafts (changed pages first) and live articles nobody has confirmed.
    const drafts = articles.filter(a => a.status === 'draft').sort((a, b) => Number(!!b.source_changed_at) - Number(!!a.source_changed_at))
    const unchecked = published.filter(a => !a.checked_on)

    const needle = search.trim().toLowerCase()
    const originOf = (a: KnowledgeArticle) => officialName(a.source) ?? (a.source?.trim() ? 'other' : 'none')
    const agencies = [...new Set(articles.map(originOf))].filter(o => o !== 'other' && o !== 'none').sort()
    const origins = ['all', ...agencies, 'other', 'none'].filter(o => o === 'all' || articles.some(a => originOf(a) === o))
    const originLabel = (o: string) => (o === 'all' ? 'All' : o === 'other' ? 'Other source' : o === 'none' ? 'No source' : o)
    const filtered = articles.filter(a => (origin === 'all' || originOf(a) === origin)
        && (!needle || [a.title, a.content, ...a.tags].some(t => t.toLowerCase().includes(needle))))

    const open = (article: KnowledgeArticle | null, gap: EditorGap | null = null) => { setSaveError(null); setEditor({ article, gap }) }
    const close = () => { setEditor(null); setSaveError(null) }

    const dismiss = async (ids: string[]) => {
        const res = await post('/api/admin/knowledge/gaps/resolve', { ids })
        if (res?.ok) setGaps(prev => prev.filter(g => g.ids[0] !== ids[0]))
        else setAlert({ type: 'error', message: "Couldn't remove it. Please try again." })
    }
    // Marking wrong only stops the answer; it leaves the list once it is fixed.
    const markWrong = async (g: QuestionGroup) => {
        const res = await post('/api/admin/knowledge/gaps/wrong', { ids: g.ids })
        if (!res?.ok) setAlert({ type: 'error', message: "Couldn't stop this answer. Please try again." })
        return !!res?.ok
    }
    const sourcesOf = (g: QuestionGroup) => [...new Set(articles.filter(a => g.articleIds.includes(a.id) && a.source).map(a => a.source))].join(', ')

    const save = async (input: KnowledgeArticleInput) => {
        setSaving(true)
        setSaveError(null)
        const article = editor?.article
        const res = article
            ? await post('/api/admin/knowledge/update', { id: article.id, updates: input })
            : await post('/api/admin/knowledge/create', input)
        if (res?.ok) {
            close()
            setAlert({ type: 'success', message: input.status === 'draft' ? 'Saved as draft.' : article ? 'Article saved.' : 'Article published.' })
            await load()
        } else {
            setSaveError((await res?.json().catch(() => null))?.error ?? 'Could not save. Please try again.')
        }
        setSaving(false)
    }

    const remove = async (a: KnowledgeArticle) => {
        if (!(await askConfirm({ title: `Delete "${a.title}"?`, message: a.status === 'published' ? 'Agents will stop getting it.' : undefined, confirmLabel: 'Delete', tone: 'danger' }))) return
        const res = await post('/api/admin/knowledge/delete', { id: a.id })
        if (res?.ok) { setAlert({ type: 'success', message: 'Article deleted.' }); await load() }
        else setAlert({ type: 'error', message: "Couldn't delete it. Please try again." })
    }

    const reindex = async () => {
        setReindexing(true)
        const res = await post('/api/admin/knowledge/reindex?all=true', {})
        const json = await res?.json().catch(() => null)
        if (res?.ok && json) setAlert({ type: json.failed ? 'error' : 'success', message: `Search rebuilt: ${json.embedded} articles${json.failed ? `, ${json.failed} failed` : ''}.` })
        else setAlert({ type: 'error', message: "Couldn't rebuild search. Please try again." })
        setReindexing(false)
    }

    // Amber counts are work waiting; grey ones are just sizes.
    const TABS: { key: Tab; label: string; count?: number; work?: boolean; alert?: boolean }[] = [
        { key: 'gaps', label: 'Not covered', count: notCovered.length, work: true },
        { key: 'check', label: 'Check answers', count: toCheck.length, work: true, alert: toCheck.some(g => g.down) },
        { key: 'review', label: 'Review', count: drafts.length + unchecked.length, work: true },
        { key: 'articles', label: 'Articles', count: articles.length },
        { key: 'official', label: 'Official pages' },
        { key: 'calculators', label: 'Calculators' },
    ]

    return (
        <div className="max-w-5xl mx-auto space-y-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2"><BookOpen size={24} className="text-[#03a9e7]" /> Knowledge</h1>
                    <p className="page-subtitle">Agents see these only as answers to their questions.</p>
                </div>
                <button onClick={() => open(null)} className="btn-primary min-h-11 px-4 text-sm flex items-center gap-2"><Plus size={16} /> New article</button>
            </div>

            {alert && <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />}

            {loading ? (
                <div className="space-y-3">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={72} radius={14} />)}</div>
            ) : loadFailed ? (
                <EmptyState icon={CircleAlert} iconColor="#dc2626" title="Couldn't load Knowledge" description="Check the connection and try again." action={{ label: 'Try again', onClick: () => { setLoading(true); load() } }} />
            ) : (
                <>
                    <div role="tablist" className="flex gap-6 border-b border-slate-200 overflow-x-auto overflow-y-hidden">
                        {TABS.map(t => (
                            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setPicked(t.key)}
                                className={`min-h-11 pb-1 -mb-px border-b-2 text-sm font-semibold whitespace-nowrap flex items-center gap-2 ${tab === t.key ? 'border-[#03a9e7] text-[#052d4a]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                {t.label}
                                {t.count !== undefined && <span className={`text-xs rounded-full px-2 py-0.5 tabular-nums ${t.alert ? 'bg-red-50 text-red-700' : t.work && t.count ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>}
                            </button>
                        ))}
                    </div>

                    {tab === 'gaps' && <NotCovered groups={notCovered} onDismiss={dismiss} onWrite={g => open(null, { question: g.question, ids: g.ids, addWording: true })} />}
                    {tab === 'check' && (
                        <CheckAnswers groups={toCheck} articles={articles} onDismiss={dismiss} onWrong={markWrong}
                            onSaveAsArticle={g => open(null, { question: g.question, ids: g.ids, answer: g.answer, source: sourcesOf(g), addWording: true })}
                            onFixArticle={(g, a) => open(a, { question: g.question, ids: g.ids, addWording: false })}
                            onRewrite={g => open(null, { question: g.question, ids: g.ids, addWording: true })} />
                    )}
                    {tab === 'review' && (
                        <div className="space-y-4">
                            <div className="inline-flex gap-1 p-1 rounded-xl bg-slate-100" role="tablist" aria-label="Which articles">
                                {([['publish', 'Not live yet', drafts.length], ['check', 'Live, not checked', unchecked.length]] as const).map(([k, label, n]) => (
                                    <button key={k} role="tab" aria-selected={queue === k} onClick={() => setQueue(k)}
                                        className={`min-h-11 px-4 rounded-lg text-sm font-semibold inline-flex items-center gap-2 ${queue === k ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                        {label} <span className="tabular-nums text-xs opacity-70">{n}</span>
                                    </button>
                                ))}
                            </div>
                            <KnowledgeWorkList key={queue} mode={queue} articles={queue === 'publish' ? drafts : unchecked}
                                onOpen={(_, list) => setReviewing(list)} onDone={load} />
                        </div>
                    )}
                    {tab === 'official' && <OfficialSources articles={articles} onChanged={load} onOpenCalculator={k => { setCalcFocus(k); setPicked('calculators') }} />}
                    {tab === 'calculators' && <CalculatorGuide key={calcFocus ?? 'all'} focus={calcFocus} />}
                    {tab === 'articles' && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="flex-1 max-w-60 h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${published.length ? (checked / published.length) * 100 : 0}%` }} /></div>
                                <p className="text-sm text-slate-600">{checked} of {published.length} live articles checked{unchecked.length > 0 && <> · <button onClick={() => { setQueue('check'); setPicked('review') }} className="underline min-h-11">check the rest</button></>}</p>
                            </div>

                            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-[#03a9e7]">
                                <Search size={16} className="text-slate-400 shrink-0" />
                                <input value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE) }} aria-label="Search articles" placeholder="Search articles" className="flex-1 min-w-0 min-h-11 text-base sm:text-sm bg-transparent outline-none" />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-1">Source</span>
                                {origins.map(o => (
                                    <button key={o} aria-pressed={origin === o} onClick={() => { setOrigin(o); setShown(PAGE) }}
                                        className={`min-h-11 px-3.5 rounded-full border text-sm font-medium ${origin === o ? 'bg-[#0369a1] border-[#0369a1] text-white' : 'bg-white border-slate-200 text-slate-600'}`}>
                                        {originLabel(o)} <span className="tabular-nums opacity-70">{o === 'all' ? articles.length : articles.filter(a => originOf(a) === o).length}</span>
                                    </button>
                                ))}
                            </div>

                            {filtered.length === 0 ? (
                                <EmptyState icon={BookOpen} iconColor="#03a9e7" title={articles.length ? 'No articles match' : 'No articles yet'} description={articles.length ? 'Try another search or filter.' : 'Write the first one.'}
                                    action={articles.length ? undefined : { label: 'New article', onClick: () => open(null) }} />
                            ) : (
                                <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
                                    {filtered.slice(0, shown).map(a => <ArticleRow key={a.id} a={a} onOpen={() => open(a)} onDelete={() => remove(a)} />)}
                                </ul>
                            )}
                            {filtered.length > shown && (
                                <button onClick={() => setShown(s => s + PAGE)} className="btn-ghost w-full min-h-11 text-sm">Load more ({filtered.length - shown} remaining)</button>
                            )}
                            <p className="text-xs text-slate-500">
                                Articles not being found?{' '}
                                <button onClick={reindex} disabled={reindexing} className="underline py-2 disabled:opacity-50">{reindexing ? 'Rebuilding search…' : 'Rebuild search'}</button>
                            </p>
                        </div>
                    )}
                </>
            )}

            {reviewing && <DraftReview drafts={reviewing} sections={{}} onChanged={load} onClose={() => setReviewing(null)} />}

            {editor && (
                <KnowledgeEditorModal
                    key={editor.article?.id ?? 'new'}
                    initial={editor.article}
                    gap={editor.gap}
                    saving={saving}
                    error={saveError}
                    onSave={save}
                    onUseExisting={id => { const a = articles.find(x => x.id === id); if (a) open(a, editor.gap) }}
                    onClose={close}
                />
            )}
        </div>
    )
}

function ArticleRow({ a, onOpen, onDelete }: { a: KnowledgeArticle; onOpen: () => void; onDelete: () => void }) {
    return (
        <li className="flex items-start gap-2 hover:bg-slate-50">
            <button onClick={onOpen} className="flex-1 min-w-0 text-left px-4 py-3.5">
                <span className="block text-[15px] font-semibold text-[#052d4a]">{a.title}</span>
                <span className="text-sm text-slate-600 line-clamp-2 mt-0.5">{a.content}</span>
                <ArticleMeta a={a} />
            </button>
            <button onClick={onDelete} aria-label={`Delete ${a.title}`} className="shrink-0 w-11 h-11 mt-2 mr-2 grid place-items-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
        </li>
    )
}
