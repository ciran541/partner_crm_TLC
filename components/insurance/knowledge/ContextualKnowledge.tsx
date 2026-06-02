'use client'

import { useEffect, useState } from 'react'
import { KnowledgeArticle } from '@/lib/types/knowledge'
import { ExpandableCard } from '@/components/insurance/workflow/WorkflowStep'

type Article = Pick<KnowledgeArticle, 'id' | 'title' | 'content'>

interface Props {
    caseType: string
    step: string
}

/**
 * Surfaces admin-managed knowledge articles tagged to the current workflow step.
 * Renders nothing if there are no matches (so it never adds noise).
 */
export default function ContextualKnowledge({ caseType, step }: Props) {
    const [articles, setArticles] = useState<Article[]>([])

    useEffect(() => {
        let active = true
        fetch(`/api/insurance/knowledge/contextual?case_type=${encodeURIComponent(caseType)}&step=${encodeURIComponent(step)}`)
            .then(r => r.json())
            .then(j => { if (active) setArticles(j.data ?? []) })
            .catch(() => { if (active) setArticles([]) })
        return () => { active = false }
    }, [caseType, step])

    if (articles.length === 0) return null

    return (
        <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Related Guidance</p>
            {articles.map(a => (
                <ExpandableCard key={a.id} variant="knowledge" title={a.title}>
                    {a.content}
                </ExpandableCard>
            ))}
        </div>
    )
}
