import { KnowledgeArticle } from '@/lib/types/knowledge'

/** Where an article's answer came from and who checked it. */
export function ArticleSource({ article: a }: { article: Pick<KnowledgeArticle, 'source' | 'checked_by' | 'checked_on'> }) {
    if (!a.source && !a.checked_on) return null
    const link = a.source && URL.canParse(a.source) && /^https?:/.test(a.source) ? a.source : null
    return (
        <p className="text-xs text-slate-500 mt-3 break-words">
            {a.source && <>Source: {link
                ? <a href={link} target="_blank" rel="noopener noreferrer" className="text-[#0369a1] underline">{new URL(link).hostname.replace(/^www\./, '')}</a>
                : a.source}</>}
            {a.source && a.checked_on && ' · '}
            {a.checked_on && <>Checked {a.checked_on}{a.checked_by ? ` by ${a.checked_by}` : ''}</>}
        </p>
    )
}

export default function KnowledgeArticleView({ article }: { article: Pick<KnowledgeArticle, 'title' | 'content' | 'source' | 'checked_by' | 'checked_on'> }) {
    return (
        <div>
            <p className="text-sm font-semibold text-slate-800">{article.title}</p>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line mt-2">{article.content}</p>
            <ArticleSource article={article} />
        </div>
    )
}
