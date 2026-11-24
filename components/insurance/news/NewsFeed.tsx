'use client'

import { useState } from 'react'
import { Newspaper } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import NewsListItem from '@/components/insurance/resources/NewsListItem'
import { NEWS_SOURCES } from '@/lib/types/news'
import { usePagedNews, LoadMoreButton } from '@/components/insurance/news/usePagedNews'

const PAGE_SIZE = 20

/**
 * Agent-facing Mortgage News feed, shared by the Premium (/insurance) and the
 * Basic/Starter (/property) Resources pages — they only differ by accent colour.
 * Paged server-side; the source chips filter on the server too, so a source
 * shows all of its articles, not just those inside the first page.
 */
export default function NewsFeed({ accentColor = '#03a9e7' }: { accentColor?: string }) {
    const [sourceFilter, setSourceFilter] = useState<string>('')
    const feed = usePagedNews('/api/insurance/resources/news', { source: sourceFilter || undefined }, PAGE_SIZE)

    const chip = (active: boolean) =>
        `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            active ? 'bg-[#052d4a] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                <button onClick={() => setSourceFilter('')} className={chip(!sourceFilter)}>All</button>
                {NEWS_SOURCES.map(s => (
                    <button key={s.key} onClick={() => setSourceFilter(s.key)} className={chip(sourceFilter === s.key)}>
                        {s.name}
                    </button>
                ))}
            </div>

            {feed.loading ? (
                <div className="flex justify-center py-24"><Spinner /></div>
            ) : feed.error && feed.rows.length === 0 ? (
                <div className="card text-center py-12 text-sm text-red-500">{feed.error}</div>
            ) : feed.rows.length === 0 ? (
                <EmptyState
                    icon={Newspaper}
                    iconColor={accentColor}
                    // With a source chip selected, the all-sources copy reads as though the
                    // whole feed were empty — say which source is filtered instead.
                    title={sourceFilter
                        ? `Nothing from ${NEWS_SOURCES.find(s => s.key === sourceFilter)?.name ?? 'this source'} right now`
                        : 'No mortgage-related news right now'}
                    description={sourceFilter
                        ? 'This source is checked daily, but nothing it published recently was mortgage or property-finance related. Try “All”, or another source.'
                        : 'We check Business Times, CNA, Financial Times, The Edge Singapore, MAS, URA and HDB daily for anything relevant to mortgages and the property market.'}
                />
            ) : (
                <div className="space-y-3">
                    {feed.rows.map(a => <NewsListItem key={a.id} article={a} />)}
                    <LoadMoreButton remaining={feed.total - feed.rows.length} loading={feed.loadingMore} onClick={feed.loadMore} />
                    {feed.error && <p className="text-xs text-red-500 text-center">{feed.error}</p>}
                </div>
            )}

            <p className="text-xs text-slate-400 mt-4 text-center">
                Sources: Business Times · CNA · Financial Times · The Edge Singapore · MAS · URA · HDB &nbsp;·&nbsp; AI relevance filtering and summaries
            </p>
        </div>
    )
}
