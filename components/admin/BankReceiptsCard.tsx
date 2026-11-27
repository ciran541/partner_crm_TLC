'use client'

import { useState } from 'react'
import Modal from '@/components/shared/Modal'
import { FIELD, day, money, postJson, useGet } from '@/components/admin/ui'
import { todaySgt } from '@/lib/insurance/promotions'
import { askConfirm } from '@/components/shared/ConfirmDialog'

interface Row { id: string; kind: string; amount: number; bank: string | null; received_on: string; reverses: string | null; reversed: boolean; bank_transfers: { reference: string | null } | null }

/** Case page: what the bank has paid TLC for this case; record a payment, a clawback or a reversal. */
export default function BankReceiptsCard({ caseId, expected, canReceive, onChanged }: {
    caseId: string
    /** 0.15% of the loan. */
    expected: number
    canReceive: boolean
    onChanged?: () => void
}) {
    const { data, error, reload } = useGet<{ rows: Row[]; total: number; untracked: boolean }>(`/api/admin/finance/receipts?caseId=${caseId}`)
    const [form, setForm] = useState<'receipt' | 'clawback' | null>(null)
    const [amount, setAmount] = useState('')
    const [on, setOn] = useState(todaySgt())
    const [reference, setReference] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const rows = data?.rows ?? []
    const received = Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100
    const gap = Math.round((expected - received) * 100) / 100

    const save = async (body: unknown) => {
        setBusy(true); setErr(null)
        try { await postJson('/api/admin/finance/receipts', body); setForm(null); setReference(''); reload(); onChanged?.() }
        catch (e) { setErr(e instanceof Error ? e.message : 'Could not save') }
        finally { setBusy(false) }
    }
    const open = (k: 'receipt' | 'clawback') => { setErr(null); setOn(todaySgt()); setAmount(k === 'receipt' && gap > 0 ? gap.toFixed(2) : ''); setForm(k) }

    return (
        <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-bold text-[#052d4a]">Received from bank</h3>
                {data && <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Math.abs(gap) <= 0.005 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {Math.abs(gap) <= 0.005 ? 'Paid in full' : !rows.length && data.untracked ? 'Before tracking' : gap > 0 ? (received > 0 ? `${money(gap)} short` : 'Waiting for bank') : `${money(-gap)} extra`}
                </span>}
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <p className="text-sm text-slate-600">{money(received)} of {money(expected)} (0.15%)</p>
            {rows.map(r => (
                <div key={r.id} className="flex items-center gap-3 text-sm border-t border-slate-100 pt-2 flex-wrap">
                    <span className="text-slate-500">{day(r.received_on)}</span>
                    <span className="flex-1 text-slate-600">{[r.kind === 'receipt' ? r.bank : r.kind === 'clawback' ? 'Clawback' : 'Reversal', r.bank_transfers?.reference].filter(Boolean).join(' · ')}</span>
                    <b className={Number(r.amount) < 0 ? 'text-red-600' : r.reversed ? 'text-slate-400 line-through' : ''}>{money(Number(r.amount))}</b>
                    {!r.reverses && !r.reversed && <button type="button" disabled={busy} className="min-h-[44px] px-2 text-xs font-semibold text-slate-500 hover:text-red-600"
                        onClick={async () => { if (await askConfirm({ title: 'Reverse this record?', message: 'The original stays on record.', confirmLabel: 'Reverse', tone: 'danger' })) save({ reverses: r.id }) }}>Reverse</button>}
                </div>
            ))}
            <div className="flex gap-2 flex-wrap">
                {canReceive && <button type="button" disabled={!data} onClick={() => open('receipt')} className="min-h-[44px] px-4 rounded-xl bg-[#052d4a] text-white text-sm font-bold disabled:opacity-40">Record payment</button>}
                {received > 0 && <button type="button" onClick={() => open('clawback')} className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600">Clawback</button>}
            </div>
            {!form && err && <p role="alert" className="text-sm text-red-600">{err}</p>}
            {form && (
                <Modal title={form === 'receipt' ? 'Received from bank' : 'Bank clawback'} onClose={() => { if (!busy) setForm(null) }}>
                    <div className="space-y-3">
                        {form === 'clawback' && <p className="text-sm text-slate-600">Money the bank took back from TLC. The agent&apos;s payout isn&apos;t changed automatically.</p>}
                        <label className="block text-xs font-semibold text-slate-600">Amount (SGD)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} className={`${FIELD} w-full mt-1 block`} /></label>
                        <label className="block text-xs font-semibold text-slate-600">Date<input type="date" value={on} max={todaySgt()} onChange={e => setOn(e.target.value)} className={`${FIELD} w-full mt-1 block`} /></label>
                        <label className="block text-xs font-semibold text-slate-600">Bank reference (optional)<input value={reference} maxLength={120} onChange={e => setReference(e.target.value)} className={`${FIELD} w-full mt-1 block`} /></label>
                        {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
                        <button type="button" disabled={busy || !(Number(amount) > 0) || !on} className="w-full min-h-[44px] rounded-xl bg-[#052d4a] text-white text-sm font-bold disabled:opacity-40"
                            onClick={() => save({ kind: form, receivedOn: on, reference: reference || undefined, items: [{ caseId, amount: Number(amount), seen: received }] })}>
                            {busy ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    )
}
