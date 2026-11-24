'use client'

import { useState } from 'react'
import Modal from '@/components/shared/Modal'
import { postJson } from '@/components/admin/ui'
import { CORRECTION_FEE } from '@/lib/insurance/commission'
import type { Case } from '@/lib/types'

/** Admin: send a Closed Won case back to the agent to fix. To fix it yourself, use Edit case. */
export default function CorrectionModal({ caseData, onClose, onDone }: { caseData: Case; onClose: () => void; onDone: (updated: Case) => void }) {
    const [reason, setReason] = useState('')
    const [charge, setCharge] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const paid = Number(caseData.commission_paid_total ?? 0) !== 0

    const save = async () => {
        setBusy(true); setError('')
        try {
            onDone(await postJson<Case>(`/api/admin/insurance/cases/${caseData.id}/correction`, { reason, charge, updated_at: caseData.updated_at }))
        } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send the case back'); setBusy(false) }
    }
    return (
        <Modal title="Send back to agent" onClose={() => { if (!busy) onClose() }}>
            <div className="space-y-4">
                <p className="text-sm text-slate-600">The case returns to Pending Signature so the agent can fix and close it again. They see the reason and the fee.</p>
                {paid && <p className="text-sm text-red-600">This case has been paid, fully or partly. Reverse the payout first.</p>}
                <label className="block text-sm font-semibold text-slate-700">Reason
                    <textarea className="w-full border border-slate-200 rounded-lg p-3 mt-1 font-normal" rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} />
                </label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-5 h-5" checked={charge} onChange={e => setCharge(e.target.checked)} disabled={busy} /> Deduct the ${CORRECTION_FEE} correction fee</label>
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={onClose} disabled={busy} className="min-h-[44px] px-4 text-sm font-semibold text-slate-500">Cancel</button>
                    <button type="button" onClick={save} disabled={busy || paid || !reason.trim()} className="min-h-[44px] px-5 rounded-xl bg-red-600 text-white text-sm font-bold disabled:opacity-40">{busy ? 'Saving…' : 'Send back'}</button>
                </div>
            </div>
        </Modal>
    )
}
