'use client'

import { useRef, useState } from 'react'
import { RotateCcw, Search, X } from 'lucide-react'
import KnowledgeReply, { type AskResult } from './KnowledgeReply'
import type { CalcValues } from '@/lib/insurance/knowledgeCalc'
import Spinner from '@/components/shared/Spinner'
import Modal from '@/components/shared/Modal'

// Each is answered free.
const EXAMPLES = [
    { title: 'Rules', questions: ['What is the clawback period?', 'Repricing vs refinancing', 'What is the minimum equity loan amount?'] },
    { title: 'Sums', questions: ['BSD on 1.5m condo', 'Longest tenure for BTO, age 45', 'Monthly instalment 800k at 1.6% 25 years'] },
    { title: 'Today', questions: ['Lowest rates now', 'Current 3M SORA', 'Any bank promotions now'] },
]

interface Props {
    autoFocus?: boolean
}

/**
 * Ask a question. The answer says where it came from: live HUB data, a HUB
 * calculator, an approved article, or AI combining several articles.
 */
export default function KnowledgeAsk({ autoFocus }: Props) {
    const [q, setQ] = useState('')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<AskResult | null>(null)
    const [asked, setAsked] = useState('')
    const [error, setError] = useState('')
    const [showDisclaimer, setShowDisclaimer] = useState(false)
    const input = useRef<HTMLInputElement>(null)

    // Back to an empty box and the example questions, ready to type.
    const reset = () => {
        if (loading) return
        setQ(''); setAsked(''); setResult(null); setError('')
        input.current?.focus()
    }

    const send = async (question: string, calc?: { kind: string; values: CalcValues }) => {
        setLoading(true)
        setError('')
        try {
            const res = await fetch('/api/insurance/knowledge/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question, calc }),
            })
            const json = await res.json().catch(() => null)
            if (!res.ok || !json?.type) throw new Error(json?.error)
            setResult(json)
        } catch (e) {
            // A failure must never read as "not covered".
            setError((e instanceof Error && e.message) || "Couldn't get an answer. Please try again.")
            if (!calc) setResult(null)
        } finally {
            setLoading(false)
        }
    }

    const ask = (question: string) => {
        question = question.trim()
        if (question.length < 2 || loading) return
        setQ(question)
        setAsked(question)
        setResult(null)
        send(question)
    }

    return (
        <div className="space-y-4">
            <form role="search" onSubmit={e => { e.preventDefault(); ask(q) }} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white shadow-sm pl-4 pr-2 py-2 focus-within:border-[#03a9e7] focus-within:ring-2 focus-within:ring-[#03a9e7]/15">
                <Search size={18} className="shrink-0 text-slate-400" />
                <input
                    ref={input}
                    autoFocus={autoFocus}
                    type="text"
                    value={q}
                    maxLength={500}
                    onChange={e => setQ(e.target.value)}
                    // After an answer, tapping the box selects the old question so typing replaces it.
                    onFocus={e => { if (asked && q === asked) e.currentTarget.select() }}
                    onKeyDown={e => { if (e.key === 'Escape' && q) { e.preventDefault(); reset() } }}
                    aria-label="Your question"
                    placeholder="Ask about rules, sums or today's rates"
                    className="flex-1 min-w-0 min-h-11 text-base bg-transparent outline-none"
                />
                {q && !loading && (
                    <button type="button" onClick={reset} aria-label="Clear and ask another question"
                        className="shrink-0 w-11 h-11 grid place-items-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={18} /></button>
                )}
                <button type="submit" disabled={loading || q.trim().length < 2} className="btn-primary shrink-0 min-h-11 px-5 text-sm disabled:opacity-40">Ask</button>
            </form>

            {!asked && (
                <div className="grid gap-5 sm:grid-cols-3 pt-2">
                    {EXAMPLES.map(g => (
                        <div key={g.title}>
                            <p className="text-sm font-bold text-[#052d4a] mb-1.5">{g.title}</p>
                            {g.questions.map(x => (
                                <button key={x} type="button" onClick={() => ask(x)} className="block w-full text-left min-h-11 py-2 text-sm text-slate-600 hover:text-[#0369a1]">{x}</button>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {loading && (
                <div className="flex justify-center py-8"><Spinner size="md" color="#03a9e7" label="Finding the answer…" /></div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {result && (!loading || result.type === 'calc') && (
                <div className={loading ? 'hidden' : ''}>
                    <KnowledgeReply key={asked} result={result} question={asked} busy={loading} onCalc={(kind, values) => send(asked, { kind, values })} onAsk={ask} />
                    <div className="flex justify-center pt-4">
                        <button type="button" onClick={reset} className="min-h-11 px-5 rounded-full border border-slate-200 bg-white text-sm font-semibold text-[#052d4a] hover:border-slate-300 inline-flex items-center gap-2">
                            <RotateCcw size={15} /> Ask another question
                        </button>
                    </div>
                </div>
            )}
            {error && !result && asked && !loading && (
                <div className="flex justify-center"><button type="button" onClick={reset} className="min-h-11 px-4 text-sm font-semibold text-[#0369a1]">Start again</button></div>
            )}

            <p className="text-xs text-slate-500">
                Check important details with the banker or lawyer before advising clients. Don&apos;t type client names.{' '}
                <button type="button" onClick={() => setShowDisclaimer(true)} className="underline py-2">Disclaimer</button>
            </p>

            {showDisclaimer && (
                <Modal title="Important Notice" onClose={() => setShowDisclaimer(false)}>
                    <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
                        <p>
                            Information provided by TLC HUB is intended for general guidance and reference only. While we strive to ensure accuracy,
                            information may be incomplete, outdated or subject to changes in bank policies and regulatory requirements.
                        </p>
                        <p>
                            Users are responsible for independently verifying relevant information with bankers, lawyers or other qualified
                            professionals where necessary. TLC shall not be liable for any loss or damage arising from reliance on the information
                            provided, to the extent permitted by applicable law.
                        </p>
                    </div>
                </Modal>
            )}
        </div>
    )
}
