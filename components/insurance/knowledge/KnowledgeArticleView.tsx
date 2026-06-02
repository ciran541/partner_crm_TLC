'use client'

import { KnowledgeArticle } from '@/lib/types/knowledge'
import { BookOpen } from 'lucide-react'

interface Props {
    article: Pick<KnowledgeArticle, 'title' | 'content' | 'category' | 'tags'>
    compact?: boolean
}

export default function KnowledgeArticleView({ article, compact }: Props) {
    return (
        <div className={compact ? '' : 'space-y-2'}>
            <div className="flex items-start gap-2.5">
                <BookOpen size={15} className="text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">{article.title}</p>
                    <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                        {article.category}
                    </span>
                </div>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line mt-2">
                {article.content}
            </p>
            {article.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {article.tags.map(t => (
                        <span key={t} className="text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">#{t}</span>
                    ))}
                </div>
            )}
        </div>
    )
}
