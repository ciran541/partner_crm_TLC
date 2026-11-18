'use client'
import { useState } from 'react'
import type { Case } from '@/lib/types'

export default function CorrectionModal({ caseData, onClose, onDone }: { caseData: Case; onClose: () => void; onDone: (updated: Case) => void }) {
    const [reason, setReason] = useState('')
    const [charge, setCharge] = useState(true)
    const [reopen, setReopen] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    async function save() {
        if (busy || !reason.trim()) return
        setBusy(true); setError('')
        try {
            const res = await fetch(`/api/admin/insurance/cases/${caseData.id}/correction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim(), charge, mode: reopen ? 'reopen' : 'record', updated_at: caseData.updated_at }) })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Unable to record correction')
            onDone(data)
        } catch (e) { setError(e instanceof Error ? e.message : 'Unable to record correction') }
        finally { setBusy(false) }
    }
    return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Record submission correction">
        <div className="bg-white rounded-2xl p-6 max-w-lg w-full space-y-4">
            <h2 className="text-lg font-bold">Record submission correction</h2>
            <label className="block text-sm">Reason (required)<textarea className="w-full border rounded-lg p-2 mt-1" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} disabled={busy} /></label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={charge} onChange={e => setCharge(e.target.checked)} disabled={busy} />Deduct $50 correction admin fee from payout</label>
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={reopen} onChange={e => setReopen(e.target.checked)} disabled={busy} />Return to Pending Signature for the agent to correct and resubmit</label>
            <p className="text-xs text-slate-500">The reason and fee decision will be visible to the agent. Paid cases must be marked unpaid before recording a correction.</p>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-3"><button onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button><button onClick={save} disabled={busy || !reason.trim()} className="btn-primary disabled:opacity-50">{busy ? 'Saving…' : 'Record correction'}</button></div>
        </div>
    </div>
}
