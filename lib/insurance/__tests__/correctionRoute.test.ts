import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/auth/requireAdmin', () => ({ requireAdminUser: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }))
import { POST } from '@/app/api/admin/insurance/cases/[id]/correction/route'

const request = (body: unknown) => new Request('http://localhost/correction', { method: 'POST', body: JSON.stringify(body) })
const context = { params: Promise.resolve({ id: 'case-id' }) }
const input = { reason: 'Wrong loan amount', charge: true, mode: 'reopen', updated_at: '2026-11-18T00:00:00Z' }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ authorized: true, userId: 'admin-id' }) })

describe('admin correction endpoint', () => {
    it('rejects unauthorized callers before accessing cases', async () => {
        mocks.auth.mockResolvedValue({ authorized: false, response: new Response(null, { status: 403 }) })
        expect((await POST(request(input), context)).status).toBe(403)
        expect(mocks.from).not.toHaveBeenCalled()
    })
    it('requires a reason and an explicit fee decision', async () => {
        expect((await POST(request({ ...input, reason: ' ' }), context)).status).toBe(400)
        expect((await POST(request({ ...input, charge: 50 }), context)).status).toBe(400)
        expect(mocks.from).not.toHaveBeenCalled()
    })
    it.each([
        { stage: 'Closed Won', commission_status: 'paid', updated_at: input.updated_at },
        { stage: 'Pending Signature', commission_status: 'unpaid', updated_at: input.updated_at },
        { stage: 'Closed Won', commission_status: 'unpaid', updated_at: 'newer' },
    ])('rejects paid, reopened or stale cases', async before => {
        const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: before }) }
        mocks.from.mockReturnValue(query)
        expect((await POST(request(input), context)).status).toBe(409)
        expect(mocks.from).toHaveBeenCalledTimes(1)
    })
    it('atomically records the reason and fixed fee with a concurrency guard', async () => {
        const before = { stage: 'Closed Won', commission_status: 'unpaid', updated_at: input.updated_at, correction_fee: 0, corrections: [] }
        const read = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: before }) }
        const write = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { ...before, stage: 'Pending Signature', correction_fee: 50 } }) }
        mocks.from.mockReturnValueOnce(read).mockReturnValueOnce(write).mockReturnValueOnce({ insert: vi.fn().mockResolvedValue({ error: null }) })
        expect((await POST(request(input), context)).status).toBe(200)
        expect(write.update).toHaveBeenCalledWith(expect.objectContaining({ stage: 'Pending Signature', correction_fee: 50, corrections: [expect.objectContaining({ by: 'admin-id', reason: input.reason, fee: 50 })] }))
        expect(write.eq).toHaveBeenCalledWith('updated_at', input.updated_at)
        expect(write.eq).toHaveBeenCalledWith('commission_status', 'unpaid')
    })
})
