'use client'

import { useEffect, useState } from 'react'
import { X, Undo2, Check } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { todaySgt } from '@/lib/insurance/promotions'
import { money } from '@/components/insurance/earnings/EarningsOverview'
import { askConfirm } from '@/components/shared/ConfirmDialog'

/**
 * Admin: record a commission payout (or reverse one) for a Closed Won case.
 *
 *   Owed $1,620 · Paid so far $1,000 · Outstanding $620
 *   ── Payouts ──────────────────────────────
 *   05/12/2026  $1,000  Bank transfer #4471   [Reverse]
 *   ── Record a payout ──────────────────────
 *   Amount [$620]  Date [today]  Reference [ ]  [Record payout]
 *
 * Amount defaults to everything outstanding; lower it for a partial payment.
 * Records are permanent — a mistake is undone with "Reverse", which adds a
 * negative entry and keeps the original (POST /api/admin/insurance/payouts).
 */

interface Payout {
    id: string
    amount: number
    paid_on: string
    reference: string | null
    note: string | null
    reverses: string | null
    profiles?: { name?: string | null } | null
}

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export default function RecordPayoutModal({ caseId, clientName, owed, warning, onClose, onSaved }: {
    caseId: string
    clientName: string
    /** Agent share owed for this case (after any correction fee). */
    owed: number
    /** Shown above the form, e.g. the bank hasn't paid TLC yet. */
    warning?: string
    onClose: () => void
    onSaved: () => void
}) {
    const [payouts, setPayouts] = useState<Payout[] | null>(null)
    const [amount, setAmount] = useState('')
    const [paidOn, setPaidOn] = useState(todaySgt())
    const [reference, setReference] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const load = () => fetch(`/api/insurance/payouts?caseId=${caseId}`)
        .then(r => r.json())
        .then(d => {
            const list = (d.payouts ?? []) as Payout[]
            setPayouts(list)
            const paid = list.reduce((s, p) => s + Number(p.amount), 0)
            const out = Math.max(0, Math.round((owed - paid) * 100) / 100)
            setAmount(out > 0 ? out.toFixed(2) : '')
        })
        .catch(() => setErr('Could not load this case’s payouts. Close and try again.'))
    useEffect(() => { load() }, [caseId])   // eslint-disable-line react-hooks/exhaustive-deps

    const paid = (payouts ?? []).reduce((s, p) => s + Number(p.amount), 0)
    const outstanding = Math.round((owed - paid) * 100) / 100
    const reversedIds = new Set((payouts ?? []).map(p => p.reverses).filter(Boolean))

    const post = async (body: Record<string, unknown>) => {
        setBusy(true); setErr(null)
        try {
            const res = await fetch('/api/admin/insurance/payouts', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            })
            const d = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(d.error || 'Could not save')
            await load()
            onSaved()
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Could not save')
        } finally {
            setBusy(false)
        }
    }

    const amt = Number(amount)
    const canRecord = !busy && payouts !== null && outstanding > 0 && amt > 0 && amt <= outstanding + 0.005 && !!paidOn

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.55)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
            <div className="card w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <div>
                        <h3 className="text-base font-bold text-[#052d4a]">Payouts · {clientName}</h3>
                        <p className="text-xs text-slate-500">Each payout is a permanent record. Use Reverse to undo a mistake.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"><X size={18} /></button>
                </div>

                <div className="overflow-y-auto px-5 py-4 space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <Figure label="Owed" value={money(owed)} />
                        <Figure label="Paid so far" value={money(paid)} tone="good" />
                        <Figure label="Outstanding" value={money(Math.max(0, outstanding))} tone={outstanding > 0 ? 'warn' : undefined} />
                    </div>

                    <div>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Payouts</p>
                        {payouts === null ? (
                            <p className="text-sm text-slate-400">Loading…</p>
                        ) : payouts.length === 0 ? (
                            <p className="text-sm text-slate-400">None recorded yet.</p>
                        ) : (
                            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                                {payouts.map(p => {
                                    const isReversal = Number(p.amount) < 0
                                    const reversed = reversedIds.has(p.id)
                                    return (
                                        <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                                            <span className="text-slate-500 tabular-nums w-[84px] shrink-0">{dmy(p.paid_on)}</span>
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-bold tabular-nums ${isReversal ? 'text-red-600' : reversed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                                    {isReversal ? `−${money(-Number(p.amount))}` : money(Number(p.amount))}
                                                    {isReversal && <span className="ml-1.5 text-[11px] font-semibold">Reversal</span>}
                                                </p>
                                                {(p.reference || p.note) && <p className="text-[11px] text-slate-500 truncate">{[p.reference, p.note].filter(Boolean).join(' · ')}</p>}
                                            </div>
                                            {!isReversal && !reversed && (
                                                <button type="button" disabled={busy}
                                                    onClick={async () => { if (await askConfirm({ title: `Reverse the ${money(Number(p.amount))} payout of ${dmy(p.paid_on)}?`, message: 'The original stays on record.', confirmLabel: 'Reverse', tone: 'danger' })) post({ reverses: p.id }) }}
                                                    className="text-xs font-semibold text-slate-500 hover:text-red-600 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-50">
                                                    <Undo2 size={12} /> Reverse
                                                </button>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {warning && outstanding > 0 && <p className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-sm text-amber-900">{warning}</p>}
                    {outstanding > 0 ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-3">
                            <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wide">Record a payout</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="block">
                                    <span className="block text-xs font-semibold text-slate-600 mb-1">Amount (SGD)</span>
                                    <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                                        className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-[#03a9e7]" />
                                    <span className="block text-[11px] text-slate-500 mt-1">Full outstanding by default; lower it for a partial payment.</span>
                                </label>
                                <label className="block">
                                    <span className="block text-xs font-semibold text-slate-600 mb-1">Date paid</span>
                                    <input type="date" value={paidOn} max={todaySgt()} onChange={e => setPaidOn(e.target.value)}
                                        className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-[#03a9e7]" />
                                </label>
                                <label className="block sm:col-span-2">
                                    <span className="block text-xs font-semibold text-slate-600 mb-1">Reference <span className="font-normal text-slate-400">(optional)</span></span>
                                    <input value={reference} maxLength={120} onChange={e => setReference(e.target.value)} placeholder="e.g. PayNow ref, transfer no."
                                        className="w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm outline-none focus:border-[#03a9e7]" />
                                </label>
                            </div>
                            <button type="button" disabled={!canRecord}
                                onClick={() => post({ caseId, amount: amt, paidOn, reference: reference || undefined }).then(() => setReference(''))}
                                className="w-full h-11 rounded-xl bg-emerald-600 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40">
                                {busy ? <Spinner size="sm" color="white" label="Saving…" /> : <><Check size={16} /> Record {amt > 0 ? money(amt) : 'payout'}</>}
                            </button>
                        </div>
                    ) : payouts && payouts.length > 0 ? (
                        <p className="text-sm font-semibold text-emerald-700 bg-emerald-50 rounded-xl px-3.5 py-2.5">Fully paid.</p>
                    ) : null}

                    {err && <p className="text-sm text-red-600">{err}</p>}
                </div>
            </div>
        </div>
    )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
    return (
        <div className="rounded-xl bg-slate-50 px-2 py-2.5">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{label}</p>
            <p className={`text-base font-extrabold mt-0.5 ${tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : 'text-[#052d4a]'}`}>{value}</p>
        </div>
    )
}
