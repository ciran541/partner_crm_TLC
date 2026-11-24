import { describe, it, expect } from 'vitest'
import { parseVerdicts } from '../newsClassify'
import { aiCostUsd } from '@/lib/ai/pricing'

describe('parseVerdicts', () => {
    it('matches by number, not by order', () => {
        const r = parseVerdicts('```json\n{"results":[{"n":2,"isRelevant":true,"reason":"HDB"},{"n":1,"isRelevant":false,"reason":"x"}]}\n```', 2)
        expect(r.map(v => v?.isRelevant)).toEqual([false, true])
    })
    it('leaves missing, out-of-range and malformed entries unclassified', () => {
        const r = parseVerdicts('{"results":[{"n":1,"isRelevant":"yes"},{"n":9,"isRelevant":true},{"n":0,"isRelevant":true},null,{"n":3,"isRelevant":true}]}', 3)
        expect(r.map(v => v?.isRelevant ?? null)).toEqual([null, null, true])
    })
    it('drops a number answered both ways', () => {
        expect(parseVerdicts('{"results":[{"n":1,"isRelevant":true},{"n":1,"isRelevant":false},{"n":1,"isRelevant":true}]}', 1)).toEqual([null])
    })
    it('survives a broken reply', () => {
        expect(parseVerdicts('{"results":[{"n":1', 2)).toEqual([null, null])
        expect(parseVerdicts('null', 1)).toEqual([null])
    })
})

it('Gemini free tier costs nothing', () => expect(aiCostUsd('gemini-3.5-flash-lite', 9000, 900)).toBe(0))
