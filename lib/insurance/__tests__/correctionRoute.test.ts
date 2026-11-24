import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/auth/requireAdmin', () => ({ requireAdminUser: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }))
vi.mock('@/lib/insurance/sora', () => ({ getCurrentSora: async () => null }))
vi.mock('@/lib/google/syncFollowUpInsurance', () => ({ syncInsuranceFollowUp: vi.fn().mockResolvedValue(undefined) }))
import { POST } from '@/app/api/admin/insurance/cases/[id]/correction/route'
import { PATCH } from '@/app/api/admin/insurance/cases/[id]/route'

const request = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })
const context = { params: Promise.resolve({ id: 'case-id' }) }
const input = { reason: 'Wrong loan amount', charge: true, updated_at: '2026-11-18T00:00:00Z' }
const deny = () => mocks.auth.mockResolvedValue({ authorized: false, response: new Response(null, { status: 403 }) })
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ authorized: true, userId: 'admin-id' }) })

// Paid / stale / wrong-stage rules are enforced inside admin_edit_case().
describe('send back to agent', () => {
    it('rejects unauthorized callers before touching the case', async () => {
        deny()
        expect((await POST(request(input), context)).status).toBe(403)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it('requires a reason and an explicit fee decision', async () => {
        expect((await POST(request({ ...input, reason: ' ' }), context)).status).toBe(400)
        expect((await POST(request({ ...input, charge: 50 }), context)).status).toBe(400)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it('shows the database rule to the admin, but hides real faults', async () => {
        mocks.rpc.mockResolvedValueOnce({ error: { code: 'P0001', message: 'Reverse the payout first.' } })
        const r = await POST(request(input), context)
        expect(r.status).toBe(409)
        expect((await r.json()).error).toBe('Reverse the payout first.')
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.rpc.mockResolvedValueOnce({ error: { code: 'XX000', message: 'secret' } })
        const f = await POST(request(input), context)
        expect(f.status).toBe(500)
        expect((await f.json()).error).not.toContain('secret')
    })
    it('sends the fixed fee, reason and concurrency guard', async () => {
        mocks.rpc.mockResolvedValue({ data: { stage: 'Pending Signature' } })
        expect((await POST(request(input), context)).status).toBe(200)
        expect(mocks.rpc).toHaveBeenCalledWith('admin_edit_case', expect.objectContaining({ p_actor: 'admin-id', p_expected: input.updated_at, p_reason: input.reason, p_fee: 50, p_reopen: true, p_changes: {} }))
    })
})

describe('admin edit case', () => {
    const before = {
        id: 'case-id', created_by: 'agent', stage: 'Closed Won', case_type: 'Purchase', client_name: 'A', follow_up_date: null,
        closed_won_data: { loans: [{ kind: 'home', amount: 1_000_000, tenure: 25 }], original_loan_total: 1_000_000, combined_outstanding: 900_000, closed_at: '2026-01-01', package: { lockin_years: 2, schedule: [] }, lo_documents: [] },
    }
    const closing = { loans: [{ kind: 'home', amount: 1_000_000, tenure: 25 }], lockin_years: 2, schedule: [], bank: 'UOB', property_address: '', lo_documents: [] }
    const load = () => mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: before }) })
    const save = () => mocks.rpc.mockResolvedValue({ data: before })
    const sent = () => mocks.rpc.mock.calls[0][1].p_changes

    it('rejects unauthorized callers', async () => {
        deny()
        expect((await PATCH(request({}), context)).status).toBe(403)
    })
    it.each(['created_by', 'commission_status', 'correction_fee', 'closed_won_data'])('refuses to edit %s', async key => {
        expect((await PATCH(request({ updated_at: 'x', changes: { [key]: 'y' } }), context)).status).toBe(400)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
    it('keeps the projection when only the bank changes', async () => {
        load(); save()
        expect((await PATCH(request({ updated_at: 'x', closing, reason: 'r' }), context)).status).toBe(200)
        expect(sent().closed_won_data).toMatchObject({ bank: 'UOB', original_loan_total: 1_000_000, combined_outstanding: 900_000 })
    })
    it('works out the loan total itself', async () => {
        load(); save()
        await PATCH(request({ updated_at: 'x', reason: 'r', closing: { ...closing, loans: [{ kind: 'home', amount: 800_000, tenure: 25 }] } }), context)
        expect(sent().closed_won_data.original_loan_total).toBe(800_000)
    })
    it('refuses loans that do not fit the case type, and files outside the case folder', async () => {
        load()
        expect((await PATCH(request({ updated_at: 'x', closing: { ...closing, loans: [{ kind: 'equity', amount: 1, tenure: 1 }] } }), context)).status).toBe(400)
        expect((await PATCH(request({ updated_at: 'x', closing: { ...closing, lo_documents: [{ path: 'other/case/x.pdf', name: 'x', type: 'application/pdf' }] } }), context)).status).toBe(400)
        expect(mocks.rpc).not.toHaveBeenCalled()
    })
})
