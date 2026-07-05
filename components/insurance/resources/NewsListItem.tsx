'use client'

import { useState } from 'react'
import { Sparkles, ExternalLink } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { safeHttpUrl, type NewsArticle } from '@/lib/types/news'

function formatRelativeTime(iso: string): string {
    const date = new Date(iso)
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}h ago`
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const dayDiff = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86400000)
    if (dayDiff === 0) return 'Today'
    if (dayDiff === 1) return 'Yesterday'
    if (dayDiff < 7) return `${dayDiff} days ago`
    return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
}

const SOURCE_COLORS: Record<string, string> = {
    business_times: 'bg-blue-50 text-blue-700',
    cna:            'bg-cyan-50 text-cyan-700',
}

export default function NewsListItem({ article }: { article: NewsArticle }) {
    const [summary, setSummary] = useState(article.summary)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const getSummary = async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`/api/insurance/resources/news/${article.id}/summarize`, { method: 'POST' })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Failed to summarize')
            setSummary(json.summary)
        } catch (e: any) {
            setError(e.message ?? 'Could not generate summary')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="card !p-4">
            <div className="flex gap-3.5">
                {article.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={article.image_url}
                        alt=""
                        className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg object-cover shrink-0 bg-slate-100"
                    />
                )}

                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SOURCE_COLORS[article.feed_key] ?? 'bg-slate-100 text-slate-600'}`}>
                                {article.source}
                            </span>
                            {article.category && (
                                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                    {article.category}
                                </span>
                            )}
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">{formatRelativeTime(article.published_at)}</span>
                    </div>

                    {safeHttpUrl(article.url) ? (
                        <a href={safeHttpUrl(article.url)!} target="_blank" rel="noopener noreferrer"
                            className="font-semibold text-sm text-[#052d4a] hover:text-[#03a9e7] transition-colors flex items-start gap-1.5 mb-1.5">
                            {article.title}
                            <ExternalLink size={13} className="shrink-0 mt-0.5 text-slate-300" />
                        </a>
                    ) : (
                        <p className="font-semibold text-sm text-[#052d4a] mb-1.5">{article.title}</p>
                    )}

                    {article.description && !summary && (
                        <p className="text-xs text-slate-500 line-clamp-2 mb-3">{article.description}</p>
                    )}

                    {summary ? (
                        <div className="mt-2 bg-sky-50/60 border border-sky-100 rounded-lg p-3">
                            <p className="text-[11px] font-semibold text-[#03a9e7] flex items-center gap-1 mb-1">
                                <Sparkles size={12} /> AI Summary
                            </p>
                            <p className="text-xs text-slate-700 leading-relaxed">{summary}</p>
                        </div>
                    ) : (
                        <button onClick={getSummary} disabled={loading}
                            className="text-xs font-semibold text-[#03a9e7] hover:text-[#0284c7] flex items-center gap-1.5 disabled:opacity-50">
                            {loading ? <Spinner size="sm" color="#03a9e7" /> : <Sparkles size={13} />}
                            {loading ? 'Summarizing…' : 'Get AI Summary'}
                        </button>
                    )}
                    {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
                </div>
            </div>
        </div>
    )
}
