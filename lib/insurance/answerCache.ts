/**
 * Saved Knowledge answers: the same question over the same articles is answered
 * once. Fail-soft: any problem just means asking the model.
 */

import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'

const KEEP_DAYS = 30
const DB_TIMEOUT_MS = 1500

/**
 * Case, spacing and end punctuation don't change a question. Everything else
 * does, numbers above all, so nothing looser than this may match.
 */
const tidy = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[?!.\s]+$/, '')

export function answerKey(question: string, articles: { title: string; content: string }[], instructions: string, model: string): string {
    return createHash('sha256')
        .update(JSON.stringify([tidy(question), articles.map(a => [a.title, a.content]), instructions, model]))
        .digest('hex')
}

const cutoff = () => new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString()

export async function getSavedAnswer(key: string): Promise<string | null> {
    try {
        const { data, error } = await createAdminClient().from('ai_answer_cache').select('answer')
            .eq('key', key).gte('created_at', cutoff()).abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle()
        if (error) console.error('[answerCache] read failed:', error.message)
        return data?.answer ?? null
    } catch (err) {
        console.error('[answerCache] read failed:', String(err))
        return null
    }
}

export async function saveAnswer(key: string, answer: string): Promise<void> {
    try {
        const db = createAdminClient()
        const signal = AbortSignal.timeout(DB_TIMEOUT_MS)
        const [{ error }] = await Promise.all([
            db.from('ai_answer_cache').upsert({ key, answer, created_at: new Date().toISOString() }).abortSignal(signal),
            db.from('ai_answer_cache').delete().lt('created_at', cutoff()).abortSignal(signal),
        ])
        if (error) console.error('[answerCache] save failed:', error.message)
    } catch (err) {
        console.error('[answerCache] save failed:', String(err))
    }
}

/** Stop giving a wrong answer, and stop AI repeating it, until an article changes. */
export async function blockAnswer(key: string): Promise<boolean> {
    const { error } = await createAdminClient().from('ai_answer_cache').upsert({ key, answer: '', created_at: new Date().toISOString() })
    if (error) console.error('[answerCache] block failed:', error.message)
    return !error
}
