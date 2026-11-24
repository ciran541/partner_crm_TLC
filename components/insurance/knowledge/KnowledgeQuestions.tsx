'use client'

import { useState } from 'react'
import { BookOpen, CheckCircle2, ChevronDown, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { QuestionGroup } from '@/lib/insurance/knowledgeQuestions'
import type { KnowledgeArticle } from '@/lib/types/knowledge'

const when = (s: string) => new Date(s).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
const asked = (g: QuestionGroup) => `Asked ${g.count === 1 ? 'once' : `${g.count} times`}, last on ${when(g.lastAsked)}`
const BTN = 'min-h-11 px-4 rounded-full text-sm font-semibold disabled:opacity-40'
const PRIMARY = `${BTN} bg-[#052d4a] text-white hover:bg-[#0a3d62]`
const OUTLINE = `${BTN} border border-slate-200 bg-white text-slate-700 hover:border-slate-300`
const QUIET = `${BTN} text-slate-500 hover:text-slate-700 hover:bg-slate-100`

const Done = ({ children }: { children: React.ReactNode }) => (
    <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><CheckCircle2 size={18} className="text-emerald-600" /> {children}</p>
)

/** Questions nothing could answer. */
export function NotCovered({ groups, onWrite, onDismiss }: {
    groups: QuestionGroup[]
    onWrite: (g: QuestionGroup) => void
    onDismiss: (ids: string[]) => void
}) {
    if (!groups.length) return <Done>Nothing waiting. Questions without an answer appear here.</Done>
    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-600">Agents asked these and got no clear answer. Most asked first.</p>
            <ul className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
                {groups.map(g => (
                    <li key={g.ids[0]} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5">
                        <div className="min-w-0 flex-1 basis-64">
                            <p className="text-[15px] font-semibold text-[#052d4a] break-words">{g.question}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{asked(g)}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => onWrite(g)} className={OUTLINE}>Write article</button>
                            <button onClick={() => onDismiss(g.ids)} className={QUIET}>Dismiss</button>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    )
}

interface CheckProps {
    groups: QuestionGroup[]
    articles: KnowledgeArticle[]
    onSaveAsArticle: (g: QuestionGroup) => void
    onFixArticle: (g: QuestionGroup, a: KnowledgeArticle) => void
    onRewrite: (g: QuestionGroup) => void
    /** Stops a wrong AI answer; resolves false when it couldn't. */
    onWrong: (g: QuestionGroup) => Promise<boolean>
    onDismiss: (ids: string[]) => void
}

/** AI answers to confirm, and answers agents marked as wrong. */
export function CheckAnswers({ groups, ...rest }: CheckProps) {
    if (!groups.length) return <Done>Nothing to check. AI answers and answers marked wrong appear here for 90 days.</Done>
    return (
        <div className="space-y-3">
            <p className="text-sm text-slate-600">Answers written by AI, and any answer an agent marked as wrong.</p>
            {groups.map(g => <CheckCard key={g.ids[0]} g={g} {...rest} />)}
        </div>
    )
}

function CheckCard({ g, articles, onSaveAsArticle, onFixArticle, onRewrite, onWrong, onDismiss }: Omit<CheckProps, 'groups'> & { g: QuestionGroup }) {
    const [fixing, setFixing] = useState(false)
    const [busy, setBusy] = useState(false)
    const sources = articles.filter(a => g.articleIds.includes(a.id))
    const ai = g.kind === 'ai'

    const wrong = async () => {
        setBusy(true)
        const ok = !ai || await onWrong(g)
        setBusy(false)
        if (ok) setFixing(true)
    }

    return (
        <section className={`rounded-2xl border bg-white p-5 ${g.down ? 'border-red-200' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center gap-2 mb-2 text-xs font-semibold">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${ai ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-[#0369a1]'}`}>
                    {ai ? <Sparkles size={13} /> : <BookOpen size={13} />}{ai ? 'Written by AI' : 'From an article'}
                </span>
                {g.down > 0 && <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-red-50 text-red-700"><ThumbsDown size={13} /> {g.down} marked wrong</span>}
                {g.up > 0 && <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-700"><ThumbsUp size={13} /> {g.up} marked correct</span>}
            </div>
            <h2 className="text-base font-bold text-[#052d4a] break-words">{g.question}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{ai ? asked(g) : `Last on ${when(g.lastAsked)}`}</p>
            <p className="text-[15px] text-slate-700 whitespace-pre-line leading-relaxed mt-3">{g.answer ?? 'The answer was not stored. Ask the question again to see it.'}</p>

            {sources.length > 0 && !fixing && (
                <details className="group mt-3">
                    <summary className="inline-flex items-center gap-1.5 min-h-11 cursor-pointer list-none text-sm font-medium text-slate-600 [&::-webkit-details-marker]:hidden">
                        {ai ? `Compare with the ${sources.length === 1 ? 'article' : `${sources.length} articles`} AI was given` : 'See the article'}
                        <ChevronDown size={15} className="group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="space-y-3 pb-2">
                        {sources.map(a => (
                            <div key={a.id} className="pl-3 border-l border-slate-200">
                                <p className="text-sm font-semibold text-slate-700">{a.title}</p>
                                <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{a.content}</p>
                            </div>
                        ))}
                    </div>
                </details>
            )}

            {fixing ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                    <p className="text-sm text-slate-700">{ai ? 'Agents will no longer get this answer. ' : ''}Which article needs fixing?</p>
                    <div className="flex flex-col items-start gap-2 mt-3">
                        {sources.map(a => <button key={a.id} onClick={() => onFixArticle(g, a)} className={`${OUTLINE} text-left`}>{a.title}</button>)}
                        <button onClick={() => onRewrite(g)} className={`${OUTLINE} text-left`}>{sources.length ? 'None of these. Write a new answer' : 'Write a new answer'}</button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap items-center gap-2 mt-4">
                    {ai && g.answer && <button onClick={() => onSaveAsArticle(g)} className={PRIMARY}>Correct: save as article</button>}
                    <button onClick={wrong} disabled={busy} className={`${BTN} border border-red-200 bg-white text-red-700 hover:bg-red-50`}>{ai ? 'Wrong: fix it' : 'Fix the article'}</button>
                    <button onClick={() => onDismiss(g.ids)} className={QUIET}>{ai ? 'Ignore' : 'Article is right'}</button>
                </div>
            )}
        </section>
    )
}
