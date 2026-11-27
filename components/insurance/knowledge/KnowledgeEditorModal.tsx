'use client'

import { useEffect, useState } from 'react'
import { X, Save } from 'lucide-react'
import { KnowledgeArticle, KnowledgeArticleInput } from '@/lib/types/knowledge'
import type { TestResult } from '@/lib/insurance/knowledgeAdmin'
import Spinner from '@/components/shared/Spinner'
import { officialName } from '@/lib/insurance/officialName'

interface Props {
    initial?: KnowledgeArticle | null
    /** The agent's question this is being written for. */
    gap?: { question: string; ids: string[]; answer?: string | null; source?: string; addWording: boolean } | null
    onSave: (input: KnowledgeArticleInput) => Promise<void>
    /** Use an existing article for the gap instead of writing a new one. */
    onUseExisting: (id: string) => void
    onClose: () => void
    saving: boolean
    error: string | null
}

const INPUT = 'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)

export default function KnowledgeEditorModal({ initial, gap, onSave, onUseExisting, onClose, saving, error }: Props) {
    const [title, setTitle] = useState(initial?.title ?? gap?.question ?? '')
    const [content, setContent] = useState(initial?.content ?? gap?.answer ?? '')
    const [wordings, setWordings] = useState([...(initial?.tags ?? []), ...(gap?.addWording && initial ? [gap.question] : [])].join('\n'))
    const [source, setSource] = useState(initial?.source ?? gap?.source ?? '')
    const [checked, setChecked] = useState(false)
    const [test, setTest] = useState(gap?.question ?? '')
    const [testing, setTesting] = useState(false)
    const [result, setResult] = useState<TestResult | { error: string } | null>(null)
    const [similar, setSimilar] = useState<TestResult['similar']>([])

    const ask = async (question: string, draft: boolean): Promise<TestResult> => {
        const res = await fetch('/api/admin/knowledge/test', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, id: initial?.id, title, content: draft ? content : '', tags: lines(wordings) }),
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json) throw new Error(json?.error ?? 'Could not run the test')
        return json
    }

    // Once the question is typed, show what already exists so it isn't written twice.
    useEffect(() => {
        if (initial || title.trim().length < 4) return
        const t = setTimeout(() => { ask(title, false).then(r => setSimilar(r.similar)).catch(() => setSimilar([])) }, 600)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, initial])

    const runTest = async () => {
        setTesting(true)
        try { setResult(await ask(test || title, true)) } catch (e) { setResult({ error: e instanceof Error ? e.message : 'Could not run the test' }) } finally { setTesting(false) }
    }

    const save = (status: 'published' | 'draft') => {
        const tags = lines(wordings)
        // Keep the agent's own wording when the admin has reworded the question.
        const known = [title, ...tags].map(x => x.trim().toLowerCase())
        if (gap?.addWording && !known.includes(gap.question.trim().toLowerCase())) tags.push(gap.question.trim())
        onSave({ title: title.trim(), content: content.trim(), tags, source: source.trim() || null, status, checked, gapIds: gap?.ids ?? [] })
    }
    const canSave = !!title.trim() && !!content.trim() && !saving

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 className="text-lg font-bold text-[#052d4a]">{initial ? 'Edit Article' : 'New Article'}</h3>
                    <button onClick={onClose} aria-label="Close" className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-5 overflow-y-auto">
                    {gap && <p className="text-sm rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">Agent asked: {gap.question}</p>}
                    {initial?.official_page_id && (
                        <div className={`text-sm rounded-lg border px-3 py-2 ${initial.source_changed_at ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-sky-50 border-sky-200 text-sky-900'}`}>
                            {initial.source_changed_at
                                ? <>The {officialName(initial.source) ?? 'official'} page changed on {initial.source_changed_at.slice(0, 10)}, so agents don&apos;t see this until it is checked again.</>
                                : <>HUB drafted this from the {officialName(initial.source) ?? 'official'} page.</>}
                            {' '}Open the page, compare every figure and date, then tick the box below and publish.
                            {initial.source && URL.canParse(initial.source) && (
                                <a href={initial.source} target="_blank" rel="noopener noreferrer" className="block font-semibold underline mt-1">Open the official page ↗</a>
                            )}
                        </div>
                    )}

                    <Field label="Question" hint="One question only. Say HDB or private, buying or refinancing if it matters.">
                        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What is the clawback period?" className={INPUT} />
                    </Field>

                    {!initial && similar.length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                            <p className="font-semibold text-slate-700 mb-1">Already written. Edit one of these if the answer is the same:</p>
                            {similar.map(s => (
                                <div key={s.id} className="flex items-center justify-between gap-3 py-1">
                                    <span className="text-slate-700 min-w-0">{s.title}</span>
                                    <button type="button" onClick={() => onUseExisting(s.id)} className="shrink-0 font-semibold text-[#03a9e7] px-2 py-1">Use this</button>
                                </div>
                            ))}
                        </div>
                    )}

                    <Field label="Answer" hint="Answer in the first sentence, then exceptions. Exact figures and dates. Say what differs by bank.">
                        <textarea value={content} onChange={e => setContent(e.target.value)} rows={8} className={`${INPUT} resize-y`} style={{ fontFamily: 'inherit' }} />
                    </Field>

                    <Field label="Other ways agents ask" hint="One per line. Only wordings with exactly the same answer. Two or more words always show this article, free.">
                        <textarea value={wordings} onChange={e => setWordings(e.target.value)} rows={4} placeholder={'subsidy clawback\nreturn legal subsidy'} className={`${INPUT} resize-y`} style={{ fontFamily: 'inherit' }} />
                    </Field>

                    <Field label="Source" hint="Link or document, for example the MAS page or the bank's guide. Agents see this.">
                        <input value={source} onChange={e => setSource(e.target.value)} className={INPUT} />
                    </Field>

                    <label className="flex items-start gap-2.5 text-sm text-slate-700">
                        <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-1" />
                        <span>I have checked this answer against the source today.
                            {initial?.checked_on && <span className="block text-xs text-slate-400">Last checked by {initial.checked_by} on {initial.checked_on}</span>}
                        </span>
                    </label>

                    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
                        <p className="text-sm font-semibold text-slate-700">Test (free)</p>
                        <div className="flex gap-2">
                            <input value={test} onChange={e => { setTest(e.target.value); setResult(null) }} placeholder="Type a question the way an agent would" className={INPUT} />
                            <button type="button" onClick={runTest} disabled={testing || !content.trim() || !(test || title).trim()} className="btn-ghost px-4 text-sm shrink-0 disabled:opacity-40">{testing ? 'Testing…' : 'Test'}</button>
                        </div>
                        {result && <TestLine result={result} />}
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex flex-wrap gap-3 justify-end shrink-0 bg-slate-50/50">
                    <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                    <button onClick={() => save('draft')} disabled={!canSave} className="btn-ghost px-4 py-2 text-sm disabled:opacity-40">{initial?.status === 'published' ? 'Unpublish to draft' : 'Save draft'}</button>
                    <button onClick={() => save('published')} disabled={!canSave} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                        {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Save size={15} /> {initial?.status === 'published' ? 'Save' : 'Publish'}</>}
                    </button>
                </div>
            </div>
        </div>
    )
}

function TestLine({ result }: { result: TestResult | { error: string } }) {
    if ('error' in result) return <p className="text-sm text-red-600">{result.error}</p>
    const ok = result.outcome === 'this'
    const text = {
        this: 'Agents will get this article, free.',
        other: `Agents will get a different article: "${result.other}".`,
        several: 'Not a clear match: AI would be used. Add this wording under "Other ways agents ask".',
        none: 'Agents would not find this article. Add this wording under "Other ways agents ask".',
        calculator: 'The HUB calculator answers this one.',
        live: 'Live HUB data answers this one.',
    }[result.outcome]
    return <p className={`text-sm ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>{text}</p>
}

const Field = ({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) => (
    <label className="block">
        <span className="block text-sm font-semibold text-slate-700">{label}</span>
        <span className="block text-xs text-slate-400 mb-1.5">{hint}</span>
        {children}
    </label>
)
