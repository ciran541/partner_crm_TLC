import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = new Map<string, string>()
const db = vi.hoisted(() => ({ broken: false }))
vi.mock('@/lib/supabase/admin', () => ({
    createAdminClient: () => {
        if (db.broken) throw new Error('down')
        return {
            from: () => ({
                select: () => ({ eq: (_: string, k: string) => ({ gte: () => ({ abortSignal: () => ({ maybeSingle: async () => ({ data: store.has(k) ? { answer: store.get(k) } : null }) }) }) }) }),
                upsert: (r: { key: string; answer: string }) => ({ abortSignal: async () => { store.set(r.key, r.answer); return {} } }),
                delete: () => ({ lt: () => ({ abortSignal: async () => ({}) }) }),
            }),
        }
    },
}))
const callClaude = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai/claude', () => ({ callClaude, CLAUDE_MODEL: 'm' }))

import { answerKey } from '../answerCache'
import { composeAnswer, composeKey } from '../composeAnswer'

const A = [{ title: 'TDSR', content: '55%' }]

describe('answerKey', () => {
    const k = (q: string, a = A) => answerKey(q, a, 'rules', 'm')
    it('ignores case, spacing and end punctuation', () => expect(k('  What is  TDSR? ')).toBe(k('what is tdsr')))
    it('never mixes different numbers', () => {
        expect(k('tenure age 35')).not.toBe(k('tenure age 36'))
        expect(k('rate 1.5')).not.toBe(k('rate 15'))
    })
    it('changes when an article, the instructions or the model change', () => {
        expect(k('q')).not.toBe(k('q', [{ title: 'TDSR', content: '60%' }]))
        expect(k('q')).not.toBe(answerKey('q', A, 'new rules', 'm'))
        expect(k('q')).not.toBe(answerKey('q', A, 'rules', 'other'))
    })
})

describe('composeAnswer', () => {
    beforeEach(() => { store.clear(); db.broken = false; callClaude.mockReset() })
    it('pays once for a repeated question', async () => {
        callClaude.mockResolvedValue({ text: '55%', failure: null, complete: true })
        expect([await composeAnswer('TDSR?', A), await composeAnswer('tdsr', A)]).toEqual(['55%', '55%'])
        expect(callClaude).toHaveBeenCalledTimes(1)
    })
    it('does not save a failure or a cut-off answer', async () => {
        callClaude.mockResolvedValueOnce({ text: null, failure: 'failed' }).mockResolvedValueOnce({ text: '55', failure: null, complete: false }).mockResolvedValueOnce({ text: '55%', failure: null, complete: true })
        expect([await composeAnswer('q', A), await composeAnswer('q', A), await composeAnswer('q', A)]).toEqual([null, '55', '55%'])
        expect(callClaude).toHaveBeenCalledTimes(3)
    })
    it('never repeats or retries an answer marked wrong', async () => {
        store.set(composeKey('q', A), '')
        expect(await composeAnswer('q', A)).toBeNull()
        expect(callClaude).not.toHaveBeenCalled()
        callClaude.mockResolvedValue({ text: '60%', failure: null, complete: true })
        expect(await composeAnswer('q', [{ title: 'TDSR', content: '60%' }])).toBe('60%')
    })
    it('still answers when the database is down', async () => {
        db.broken = true
        callClaude.mockResolvedValue({ text: '55%', failure: null, complete: true })
        expect(await composeAnswer('q', A)).toBe('55%')
    })
})
