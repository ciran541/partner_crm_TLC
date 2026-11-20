import { describe, it, expect } from 'vitest'
import { loUploadedAt } from '../closedWon'

describe('loUploadedAt', () => {
    it('uses uploaded_at, falls back to the timestamp in the storage path, earliest wins', () => {
        const t1 = Date.UTC(2026, 10, 18, 2, 0)   // 18 Nov 2026
        const t2 = Date.UTC(2026, 10, 19, 2, 0)
        expect(loUploadedAt([
            { path: `u/c/${t2}-abc123.pdf`, uploaded_at: new Date(t2).toISOString() },
            { path: `u/c/${t1}-def456.jpg` },
        ])).toBe(new Date(t1).toISOString())
    })
    it('is null when nothing was uploaded or nothing is datable', () => {
        expect(loUploadedAt([])).toBeNull()
        expect(loUploadedAt(undefined)).toBeNull()
        expect(loUploadedAt([{ path: 'u/c/scan.pdf' }])).toBeNull()
    })
})
