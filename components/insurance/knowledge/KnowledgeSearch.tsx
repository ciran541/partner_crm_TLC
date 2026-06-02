'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { KnowledgeArticle } from '@/lib/types/knowledge'
import KnowledgeArticleView from './KnowledgeArticleView'
import Spinner from '@/components/shared/Spinner'

type Result = Pick<KnowledgeArticle, 'id' | 'title' | 'content' | 'category' | 'tags' | 'case_types'>

interface Props {
    autoFocus?: boolean
    placeholder?: string
}

/**
 * Agent-facing knowledge search. Hits /api/insurance/knowledge/search which
 * requires a query and never returns the full library. Debounced.
 */
export default function KnowledgeSearch({ autoFocus, placeholder = 'Search knowledge — e.g. "subsidy clawback", "TDSR"…' }: Props) {
    const [q, setQ] = useState('')
    const [results, setResults] = useState<Result[]>([])
    const [loading, setLoading] = useState(false)
    const [searched, setSearched] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (timer.current) clearTimeout(timer.current)
        if (q.trim().length < 2) {
            setResults([])
            setSearched(false)
            return
        }
        timer.current = setTimeout(async () => {
            setLoading(true)
            try {
                const res = await fetch(`/api/insurance/knowledge/search?q=${encodeURIComponent(q.trim())}`)
                const json = await res.json()
                setResults(json.data ?? [])
            } catch {
                setResults([])
            } finally {
                setLoading(false)
                setSearched(true)
            }
        }, 350)
        return () => { if (timer.current) clearTimeout(timer.current) }
    }, [q])

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    autoFocus={autoFocus}
                    type="text"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder={placeholder}
                    className="w-full pl-10 pr-9 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                />
                {q && (
                    <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <X size={15} />
                    </button>
                )}
            </div>

            {loading && (
                <div className="flex justify-center py-6"><Spinner size="sm" color="#03a9e7" label="Searching…" /></div>
            )}

            {!loading && searched && results.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">No matching guidance found. Try different keywords.</p>
            )}

            {!loading && results.length > 0 && (
                <div className="space-y-3">
                    {results.map(a => (
                        <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-4">
                            <KnowledgeArticleView article={a} />
                        </div>
                    ))}
                </div>
            )}

            {!searched && q.trim().length < 2 && (
                <p className="text-xs text-slate-400 text-center py-6">Type at least 2 characters to search.</p>
            )}
        </div>
    )
}
