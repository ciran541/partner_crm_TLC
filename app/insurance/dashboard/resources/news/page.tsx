'use client'

import { useEffect, useMemo, useState } from 'react'
import { Newspaper } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import NewsListItem from '@/components/insurance/resources/NewsListItem'
import { NEWS_SOURCES } from '@/lib/types/news'
import type { NewsArticle } from '@/lib/types/news'

export default function NewsPage() {
    const [articles, setArticles] = useState<NewsArticle[]>([])
    const [loading, setLoading] = useState(true)
    const [fetchErr, setFetchErr] = useState<string | null>(null)
    const [sourceFilter, setSourceFilter] = useState<string>('')

    useEffect(() => {
        setLoading(true)
        fetch('/api/insurance/resources/news')
            .then(r => r.ok ? r.json() : Promise.reject('Failed'))
            .then(d => setArticles(d.data ?? []))
            .catch(() => setFetchErr('Could not load news. Please refresh.'))
            .finally(() => setLoading(false))
    }, [])

    const filtered = useMemo(() => {
        if (!sourceFilter) return articles
        return articles.filter(a => a.feed_key === sourceFilter)
    }, [articles, sourceFilter])

    if (loading) return <div className="flex justify-center py-24"><Spinner /></div>
    if (fetchErr) return <div className="card text-center py-12 text-sm text-red-500">{fetchErr}</div>

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setSourceFilter('')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        !sourceFilter ? 'bg-[#052d4a] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                >
                    All
                </button>
                {NEWS_SOURCES.map(s => (
                    <button
                        key={s.key}
                        onClick={() => setSourceFilter(s.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                            sourceFilter === s.key ? 'bg-[#052d4a] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                    >
                        {s.name}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <EmptyState
                    icon={Newspaper}
                    iconColor="#03a9e7"
                    title="No mortgage-related news right now"
                    description="We check Business Times and CNA daily for anything relevant to mortgages and the property market."
                />
            ) : (
                <div className="space-y-3">
                    {filtered.map(a => <NewsListItem key={a.id} article={a} />)}
                </div>
            )}
        </div>
    )
}
