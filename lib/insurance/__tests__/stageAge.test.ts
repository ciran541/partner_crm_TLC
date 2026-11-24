import { describe, it, expect } from 'vitest'
import { daysInStage, isStuck } from '../stageAge'

describe('days in stage', () => {
    it('counts whole days; unknown is null', () => {
        const now = Date.parse('2026-11-24T10:00:00Z')
        expect(daysInStage('2026-11-10T11:00:00Z', now)).toBe(13)
        expect(daysInStage('2026-11-10T10:00:00Z', now)).toBe(14)
        expect(daysInStage(null, now)).toBeNull()
    })
    it('is stuck at 14 days of paperwork, 30 for a prospect', () => {
        expect(isStuck('Pending Docs', 13)).toBe(false)
        expect(isStuck('Pending Docs', 14)).toBe(true)
        expect(isStuck('Touched Base', 29)).toBe(false)
        expect(isStuck('Touched Base', 30)).toBe(true)
        expect(isStuck('Inactive', 900)).toBe(false)
        expect(isStuck('Pending Docs', null)).toBe(false)
    })
})
