/**
 * Bulk Knowledge actions for admins: publish many drafts, or mark many live
 * articles as checked. Admin routes only.
 *
 * Publishing a draft from an official page re-reads that page (once per page)
 * and skips any draft with a figure that isn't on it, so speed never lets a
 * wrong figure through. Everything else goes through saveArticle(), the one
 * save path (clash check, embedding, history).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { saveArticle } from '@/lib/insurance/knowledgeAdmin'
import { readPage } from '@/lib/insurance/officialSources'
import { evidence } from '@/lib/insurance/officialEvidence'
import { officialName } from '@/lib/insurance/officialName'

export const BULK_MAX = 100

export interface BulkResult { done: number; skipped: { id: string; title: string; why: string }[] }

export async function bulkPublish(ids: string[], userId: string): Promise<BulkResult> {
    const db = createAdminClient()
    const { data: rows, error } = await db.from('knowledge_articles')
        .select('id, title, content, tags, source, status, official_page_id').in('id', ids)
    if (error) throw new Error(error.message)

    const pageIds = [...new Set((rows ?? []).map(r => r.official_page_id).filter((x): x is string => !!x))]
    const { data: pages } = pageIds.length ? await db.from('official_pages').select('id, url').in('id', pageIds) : { data: [] }
    // Each official page is read once, however many of its drafts are selected.
    const texts = new Map<string, Promise<string | null>>()
    const pageText = (pageId: string) => {
        if (!texts.has(pageId)) {
            const url = (pages ?? []).find(p => p.id === pageId)?.url
            texts.set(pageId, url ? readPage(url).then(r => (r.ok ? r.text : null)) : Promise.resolve(null))
        }
        return texts.get(pageId)!
    }

    const result: BulkResult = { done: 0, skipped: [] }
    for (const r of rows ?? []) {
        const skip = (why: string) => result.skipped.push({ id: r.id, title: r.title, why })
        if (r.status !== 'draft') { skip('Already live'); continue }
        if (r.official_page_id) {
            const text = await pageText(r.official_page_id)
            const agency = officialName(r.source) ?? 'official'
            if (!text) { skip(`Couldn't open the ${agency} page to check its figures. Try again later.`); continue }
            const missing = evidence(r.title, r.content, text).figures.filter(f => !f.found).map(f => f.text)
            if (missing.length) { skip(`${missing.join(', ')} not on the ${agency} page. Open it to fix.`); continue }
        }
        const saved = await saveArticle({ title: r.title, content: r.content, tags: r.tags ?? [], source: r.source, status: 'published', checked: true, gapIds: [] }, userId, r.id)
        if (saved.error) skip(saved.error)
        else result.done++
    }
    return result
}

/** Live articles only; one that waits for a re-check after its page changed must be opened. */
export async function bulkMarkChecked(ids: string[], userId: string): Promise<BulkResult> {
    const db = createAdminClient()
    const { data: p } = await db.from('profiles').select('full_name, name').eq('id', userId).maybeSingle()
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
    const { data, error } = await db.from('knowledge_articles')
        .update({ checked_by: p?.full_name || p?.name || 'Admin', checked_on: today })
        .in('id', ids).eq('status', 'published').is('source_changed_at', null)
        .select('id')
    if (error) throw new Error(error.message)
    const done = new Set((data ?? []).map(r => r.id))
    const { data: rest } = await db.from('knowledge_articles').select('id, title, status').in('id', ids.filter(id => !done.has(id)))
    return {
        done: done.size,
        skipped: (rest ?? []).map(r => ({ id: r.id, title: r.title, why: r.status === 'published' ? 'Its official page changed: open it to check' : 'Not live yet: publish it first' })),
    }
}
