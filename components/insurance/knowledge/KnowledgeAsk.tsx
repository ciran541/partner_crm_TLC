'use client'

import { useState } from 'react'
import { Sparkles, Search, CornerDownLeft, Info } from 'lucide-react'
import { KnowledgeArticle } from '@/lib/types/knowledge'
import KnowledgeArticleView from './KnowledgeArticleView'
import Spinner from '@/components/shared/Spinner'
import Modal from '@/components/shared/Modal'

type Source = Pick<KnowledgeArticle, 'id' | 'title' | 'content' | 'category' | 'tags'>

interface AskResult {
    answer: string | null
    sources: Source[]
    grounded?: boolean
    fallback?: boolean
}

interface Props {
    autoFocus?: boolean
}

/**
 * Grounded "ask a question" experience. Calls /api/insurance/knowledge/ask which
 * retrieves matching articles and (if any) has Claude compose an answer ONLY from
 * them. Always shows the source articles beneath. Never browses the full library.
 */
export default function KnowledgeAsk({ autoFocus }: Props) {
    const [q, setQ] = useState('')
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<AskResult | null>(null)
    const [asked, setAsked] = useState('')
    const [showDisclaimer, setShowDisclaimer] = useState(false)

    const ask = async () => {
        const question = q.trim()
        if (question.length < 2 || loading) return
        setLoading(true)
        setAsked(question)
        try {
            const res = await fetch('/api/insurance/knowledge/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question }),
            })
            const json = await res.json()
            setResult(json)
        } catch {
            setResult({ answer: null, sources: [] })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-4">
            {/* Ask input */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    autoFocus={autoFocus}
                    type="text"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') ask() }}
                    placeholder='Ask a question — e.g. "what happens if my client refinances early?"'
                    className="w-full pl-10 pr-24 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                />
                <button
                    onClick={ask}
                    disabled={loading || q.trim().length < 2}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#03a9e7] text-white text-xs font-semibold hover:bg-[#0284c7] disabled:opacity-40 transition-colors"
                >
                    {loading ? <Spinner size="sm" color="white" /> : <>Ask <CornerDownLeft size={12} /></>}
                </button>
            </div>

            <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
                <Info size={12} className="shrink-0 mt-px" />
                Answers are drawn from TLC&apos;s knowledge base. Please verify important details with the relevant banker or lawyer before advising clients.
            </p>

            {loading && (
                <div className="flex justify-center py-8"><Spinner size="md" color="#03a9e7" label="Finding the answer…" /></div>
            )}

            {!loading && result && (
                <div className="space-y-4">
                    {/* Composed answer */}
                    {result.answer && (
                        <div className="rounded-xl border border-[#03a9e7]/30 bg-sky-50/50 p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <Sparkles size={14} className="text-[#03a9e7]" />
                                <span className="text-xs font-semibold text-[#0369a1]">Answer</span>
                            </div>
                            <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">{result.answer}</p>
                            {result.grounded && result.sources.length > 0 && (
                                <p className="text-[11px] text-slate-400 mt-3 pt-2 border-t border-sky-100">
                                    Composed from TLC&apos;s knowledge — verify the sources below.
                                </p>
                            )}
                        </div>
                    )}

                    {/* Fallback notice when Claude was unavailable but we have articles */}
                    {!result.answer && result.sources.length > 0 && (
                        <p className="text-sm text-slate-600 font-medium">Here&apos;s the most relevant guidance:</p>
                    )}

                    {/* Refusal (no sources at all) */}
                    {!result.answer && result.sources.length === 0 && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <p className="text-sm text-amber-800">
                                I don&apos;t have guidance on that in our knowledge base — please check with your admin.
                            </p>
                        </div>
                    )}

                    {/* Sources */}
                    {result.sources.length > 0 && (
                        <div className="space-y-2">
                            {result.answer && (
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Sources</p>
                            )}
                            {result.sources.map(s => (
                                <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-4">
                                    <KnowledgeArticleView article={s} />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={() => setShowDisclaimer(true)}
                    className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 border border-slate-200 hover:border-slate-300 rounded-md px-2 py-0.5 transition-colors"
                >
                    Disclaimer
                </button>
            </div>

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
