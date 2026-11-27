/** Saving and testing Knowledge articles (admin routes only). */

import { createAdminClient } from '@/lib/supabase/admin'
import { articleEmbedInput, embedText } from '@/lib/insurance/embed'
import { clashes, exactMatch, rankArticles, type RankableArticle } from '@/lib/insurance/knowledgeRank'
import { detectCalc } from '@/lib/insurance/knowledgeCalc'
import { detectLive } from '@/lib/insurance/knowledgeLive'
import { loadPublished, similarities } from '@/lib/insurance/retrieveKnowledge'
import { settlePage } from '@/lib/insurance/officialSources'

export interface ArticleForm {
    title: string
    content: string
    tags: string[]
    source: string | null
    status: 'published' | 'draft'
    /** Ticked: this admin confirms the answer is correct today. */
    checked: boolean
    gapIds: string[]
}

const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean) : []

export function readForm(body: Record<string, unknown>): ArticleForm | string {
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const content = typeof body.content === 'string' ? body.content.trim() : ''
    if (!title || !content) return 'Question and answer are required'
    return {
        title, content,
        tags: [...new Set(strings(body.tags))],
        source: typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null,
        status: body.status === 'draft' ? 'draft' : 'published',
        checked: body.checked === true,
        gapIds: strings(body.gapIds),
    }
}

/** Saves; returns an error message, or null when saved. */
export async function saveArticle(form: ArticleForm, userId: string, id?: string): Promise<{ error: string | null; status?: number }> {
    const db = createAdminClient()
    const { title, content, tags, source, status } = form

    if (status === 'published') {
        const clash = clashes({ id: id ?? '', title, tags }, await loadPublished())
        if (clash) return { error: `"${clash.wording}" is already used by the article "${clash.article.title}". Edit that article instead.`, status: 409 }
    }

    let unchanged = false
    let officialPage: string | null = null
    if (id) {
        const { data: old, error } = await db.from('knowledge_articles').select('content, title, source, official_page_id').eq('id', id).single()
        if (error) return { error: 'Article not found', status: 404 }
        unchanged = old.content === content && old.title === title && (old.source ?? null) === source
        officialPage = old.official_page_id ?? null
    }
    // Written from an official page: a person compares it with the page before agents see it.
    if (officialPage && status === 'published' && !form.checked) {
        return { error: 'Compare this with the official page, then tick the "checked" box to publish it.', status: 400 }
    }
    let check: { checked_by?: string | null; checked_on?: string | null } = {}
    if (form.checked) {
        const { data: p } = await db.from('profiles').select('full_name, name').eq('id', userId).maybeSingle()
        check = { checked_by: p?.full_name || p?.name || 'Admin', checked_on: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) }
    } else if (!unchanged) {
        // A check never carries over to different words.
        check = { checked_by: null, checked_on: null }
    }

    // Null on failure: an old vector would keep matching the old text.
    const embedding = await embedText(articleEmbedInput(title, content, tags))
    const row = { title, content, tags, source, status, embedding, ...check, ...(status === 'published' && form.checked ? { source_changed_at: null } : {}) }
    const { error } = id
        ? await db.from('knowledge_articles').update({ ...row, updated_at: new Date().toISOString() }).eq('id', id)
        : await db.from('knowledge_articles').insert({ ...row, category: 'General', created_by: userId })
    if (error) return { error: error.message, status: 500 }
    if (officialPage && status === 'published') await settlePage(officialPage)

    if (status === 'published' && form.gapIds.length) {
        const { error: gapErr } = await db.from('knowledge_gaps').update({ status: 'resolved' }).in('id', form.gapIds)
        if (gapErr) console.error('[knowledge] gap not closed:', gapErr.message)
    }
    return { error: null }
}

export interface TestResult {
    /** What an agent asking this would get. */
    outcome: 'this' | 'other' | 'several' | 'none' | 'calculator' | 'live'
    other?: string
    similar: { id: string; title: string }[]
}

/** Free: never calls Claude. */
export async function testQuestion(question: string, draft: { id?: string; title: string; content: string; tags: string[] }): Promise<TestResult> {
    const [published, embedding, draftVec] = await Promise.all([
        loadPublished(),
        embedText(question),
        draft.content ? embedText(articleEmbedInput(draft.title, draft.content, draft.tags)) : null,
    ])
    const id = draft.id || 'draft'
    const others: RankableArticle[] = published.filter(a => a.id !== draft.id)
    const all = draft.content ? [...others, { ...draft, id }] : others
    const sims = await similarities(embedding)
    if (embedding && draftVec) sims.set(id, embedding.reduce((s, x, i) => s + x * draftVec[i], 0))

    const { ranked, confidence } = rankArticles(question, all, sims)
    const similar = ranked.filter(r => r.article.id !== id).slice(0, 3).map(r => ({ id: r.article.id, title: r.article.title }))
    const exact = exactMatch(question, all)
    const direct = exact ?? (confidence === 'direct' ? ranked[0].article : null)
    if (!exact && detectLive(question)) return { outcome: 'live', similar }
    if (!exact && detectCalc(question)) return { outcome: 'calculator', similar }
    if (direct) return direct.id === id ? { outcome: 'this', similar } : { outcome: 'other', other: direct.title, similar }
    return { outcome: confidence === 'none' ? 'none' : 'several', similar }
}
