'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Download, FileWarning, Undo2, Wallet } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import InlineAlert from '@/components/shared/InlineAlert'
import Modal from '@/components/shared/Modal'
import Spinner from '@/components/shared/Spinner'
import RecordPayoutModal from '@/components/insurance/earnings/RecordPayoutModal'
import { MasterEarningsTable } from '@/components/insurance/earnings/EarningsViews'
import { Empty, ErrorBox, FIELD, PageTitle, Panel, Pill, Tabs, Tile, day, money, postJson, useGet } from '@/components/admin/ui'
import {
    agentOutstanding, bankOutstanding, bankState, groupByAgent, splitQueue, toCsv, type QueueRow,
} from '@/lib/insurance/financeStats'
import type { AgentCommissionRow } from '@/lib/insurance/commission'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { todaySgt } from '@/lib/insurance/promotions'
import { useRouter } from 'next/navigation'

/**
 * Payouts — the money desk (Premium).
 *
 *   Pay agents     Ready to pay (bank money in) first, then waiting for bank.
 *                  Tick cases across agents → one date + reference → Pay. Or pay
 *                  a single case, including part of it.
 *   Bank payments  Tick cases one transfer covered → record what arrived.
 *   By agent       Every agent's earnings; opens their full breakdown.
 *   History        Every payment out or in, with reversals and an Excel export.
 *
 * Paying before the bank has paid is allowed, with a warning.
 */

type Tab = 'pay' | 'bank' | 'agents' | 'history'
const BTN = 'min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40'

export default function PayoutsPage() {
    const [tab, setTab] = useState<Tab>('pay')
    const { data, error, reload } = useGet<{ rows: QueueRow[] }>('/api/admin/finance/queue')
    const [notice, setNotice] = useState<string | null>(null)
    const split = useMemo(() => splitQueue(data?.rows ?? []), [data])
    const bankDue = split.bankOpen.filter(r => bankOutstanding(r) > 0)
    const sum = (rows: QueueRow[], f: (r: QueueRow) => number) => rows.reduce((s, r) => s + f(r), 0)

    const done = (msg: string) => { setNotice(msg); invalidateCaseData(); reload() }

    return (
        <div className="space-y-5">
            <PageTitle icon={Wallet} title="Payouts" subtitle="Premium commission: in from banks, out to agents." />
            {notice && <InlineAlert type="success" message={notice} onDismiss={() => setNotice(null)} />}
            {error && <ErrorBox message={error} />}
            {data && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Tile label="Ready to pay" tone={split.ready.length ? 'warn' : undefined} value={money(sum(split.ready, agentOutstanding))} sub={`${split.ready.length} cases, bank money in`} />
                    <Tile label="Owed, waiting for bank" value={money(sum(split.waiting, agentOutstanding))} sub={`${split.waiting.length} cases`} />
                    <Tile label="Banks owe TLC" value={money(sum(bankDue, bankOutstanding))} sub={`${bankDue.length} cases`} />
                </div>
            )}
            <Tabs value={tab} onChange={setTab} tabs={[
                { key: 'pay', label: 'Pay agents', count: data ? split.ready.length + split.waiting.length : undefined },
                { key: 'bank', label: 'Bank payments', count: data ? split.bankOpen.length : undefined },
                { key: 'agents', label: 'By agent' },
                { key: 'history', label: 'History' },
            ]} />
            {tab === 'agents' ? <ByAgent /> : tab === 'history' ? <History onDone={done} />
                : !data ? !error && <Skeleton height={320} radius={14} />
                    : tab === 'pay' ? <PayAgents ready={split.ready} waiting={split.waiting} overpaid={split.overpaid} onDone={done} />
                        : <BankPayments rows={split.bankOpen} onDone={done} />}
        </div>
    )
}

function BankPill({ r }: { r: QueueRow }) {
    const s = bankState(r)
    if (s === 'received') return <Pill tone="green">Bank paid</Pill>
    if (s === 'part') return <Pill tone="amber">Bank short {money(bankOutstanding(r))}</Pill>
    if (s === 'over') return <Pill tone="blue">Bank paid {money(-bankOutstanding(r))} extra</Pill>
    if (s === 'untracked') return <Pill tone="grey">Before tracking</Pill>
    return <Pill tone="amber">Waiting for bank</Pill>
}

function CaseInfo({ r }: { r: QueueRow }) {
    return (
        <div className="min-w-0 flex-1">
            <Link href={`/admin/insurance/cases/${r.id}`} className="font-semibold text-[#0369a1] block truncate">{r.client_name || 'Unnamed'}</Link>
            <p className="text-xs text-slate-500">{r.case_type} · {r.bank === 'Not set' ? 'bank not set' : r.bank} · closed {day(r.closed_on)} · {money(r.loan)} loan</p>
            {!r.has_lo && <p className="text-xs text-amber-700 flex items-center gap-1 mt-0.5"><FileWarning size={12} /> No Letter of Offer</p>}
        </div>
    )
}

// ─── Pay agents ──────────────────────────────────────────────────────────────

function PayAgents({ ready, waiting, overpaid, onDone }: { ready: QueueRow[]; waiting: QueueRow[]; overpaid: QueueRow[]; onDone: (m: string) => void }) {
    const [month, setMonth] = useState('')
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [one, setOne] = useState<QueueRow | null>(null)
    const [confirm, setConfirm] = useState(false)
    const all = useMemo(() => [...ready, ...waiting], [ready, waiting])
    const months = [...new Set(all.map(r => r.closed_on.slice(0, 7)))].sort().reverse()
    const shown = (rows: QueueRow[]) => rows.filter(r => !month || r.closed_on.startsWith(month))
    // Only what's on screen can be paid: a hidden tick must never be.
    const chosen = shown(all).filter(r => picked.has(r.id))
    const chosenTotal = chosen.reduce((s, r) => s + agentOutstanding(r), 0)

    const toggle = (ids: string[], on: boolean) => setPicked(p => {
        const n = new Set(p)
        ids.forEach(i => (on ? n.add(i) : n.delete(i)))
        return n
    })

    const block = (title: string, hint: string, rows: QueueRow[]) => {
        const groups = groupByAgent(shown(rows))
        return (
            <Panel title={title} subtitle={hint}>
                {groups.length === 0 ? <Empty>Nothing here{month ? ' for that month' : ''}.</Empty> : groups.map(g => {
                    const ids = g.rows.map(r => r.id)
                    const on = ids.every(i => picked.has(i))
                    return (
                        <div key={g.id} className="rounded-xl border border-slate-200 overflow-hidden">
                            <label className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer">
                                <input type="checkbox" className="w-5 h-5 accent-[#052d4a]" checked={on} onChange={e => toggle(ids, e.target.checked)} aria-label={`Select all cases for ${g.name}`} />
                                <span className="font-bold text-[#052d4a] flex-1">{g.name} <span className="text-xs font-medium text-slate-500">{g.rows.length} case{g.rows.length === 1 ? '' : 's'}</span></span>
                                <b className="text-[#052d4a]">{money(g.total)}</b>
                            </label>
                            {g.rows.map(r => (
                                <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100 flex-wrap text-sm">
                                    <input type="checkbox" className="w-5 h-5 accent-[#052d4a]" checked={picked.has(r.id)} onChange={e => toggle([r.id], e.target.checked)} aria-label={`Select ${r.client_name || 'case'}`} />
                                    <CaseInfo r={r} />
                                    <BankPill r={r} />
                                    <div className="text-right w-[110px]"><b>{money(agentOutstanding(r))}</b>{r.paid > 0 && <p className="text-[11px] text-slate-500">of {money(r.agent_share)}</p>}{r.fee > 0 && <p className="text-[11px] text-red-600">after {money(r.fee)} fee</p>}</div>
                                    <button type="button" onClick={() => setOne(r)} className={`${BTN} border border-slate-200 text-slate-600 bg-white`}>Pay this</button>
                                </div>
                            ))}
                        </div>
                    )
                })}
            </Panel>
        )
    }

    return (
        <div className="space-y-5 pb-24">
            <select aria-label="Closing month" className={FIELD} value={month} onChange={e => setMonth(e.target.value)}>
                <option value="">Closed in any month</option>
                {months.map(m => <option key={m} value={m}>{new Date(`${m}-01T00:00:00`).toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })}</option>)}
            </select>
            {overpaid.length > 0 && (
                <Panel title="Paid too much" subtitle="The agent has been paid more than their share. Reverse the payout and pay the right amount.">
                    {overpaid.map(r => <div key={r.id} className="flex items-center gap-3 text-sm flex-wrap"><CaseInfo r={r} /><span>{r.agent_name}</span><b className="text-red-600">{money(-agentOutstanding(r))} over</b><button type="button" onClick={() => setOne(r)} className={`${BTN} border border-slate-200 text-slate-600`}>Payouts</button></div>)}
                </Panel>
            )}
            {block('Ready to pay', 'The bank has paid TLC in full.', ready)}
            {block('Waiting for bank', 'You can still pay these. You’ll see a warning first.', waiting)}

            {chosen.length > 0 && (
                <div className="sticky bottom-4 z-30 card p-3 sm:p-4 shadow-xl flex items-center gap-3 flex-wrap">
                    <p className="flex-1 text-sm"><b className="text-lg text-[#052d4a]">{money(chosenTotal)}</b><span className="text-slate-500"> · {chosen.length} case{chosen.length === 1 ? '' : 's'} · {groupByAgent(chosen).length} agent{groupByAgent(chosen).length === 1 ? '' : 's'}</span></p>
                    <button type="button" onClick={() => setPicked(new Set())} className={`${BTN} text-slate-500`}>Clear</button>
                    <button type="button" onClick={() => setConfirm(true)} className={`${BTN} bg-emerald-600 text-white`}>Pay together</button>
                </div>
            )}
            {confirm && <BatchModal rows={chosen} onClose={() => setConfirm(false)} onDone={m => { setConfirm(false); setPicked(new Set()); onDone(m) }} />}
            {one && <RecordPayoutModal caseId={one.id} clientName={one.client_name || 'Case'} owed={one.agent_share}
                warning={['waiting', 'part'].includes(bankState(one)) ? `The bank still owes TLC ${money(bankOutstanding(one))} for this case.` : undefined}
                onClose={() => setOne(null)} onSaved={() => onDone('Payout saved.')} />}
        </div>
    )
}

function BatchModal({ rows, onClose, onDone }: { rows: QueueRow[]; onClose: () => void; onDone: (m: string) => void }) {
    const [paidOn, setPaidOn] = useState(todaySgt())
    const [reference, setReference] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const groups = groupByAgent(rows)
    const total = rows.reduce((s, r) => s + agentOutstanding(r), 0)
    const early = rows.filter(r => ['waiting', 'part'].includes(bankState(r)))
    const save = async () => {
        setBusy(true); setErr(null)
        try {
            await postJson('/api/admin/insurance/payouts', { items: rows.map(r => ({ caseId: r.id, amount: agentOutstanding(r) })), paidOn, reference: reference || undefined })
            onDone(`Paid ${money(total)} across ${rows.length} case${rows.length === 1 ? '' : 's'}.`)
        } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); setBusy(false) }
    }
    return (
        <Modal title="Pay together" size="lg" onClose={() => { if (!busy) onClose() }}>
            <div className="space-y-4">
                <p className="text-sm text-slate-600">Each case is paid in full with its own record. If any of them can&apos;t be saved, none are.</p>
                {early.length > 0 && <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> The bank hasn&apos;t fully paid TLC for {early.length} of these: {early.slice(0, 5).map(r => r.client_name || 'Unnamed').join(', ')}{early.length > 5 ? '…' : ''}.</p>}
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
                    {groups.map(g => <div key={g.id} className="px-4 py-2.5 flex justify-between gap-3"><span><b>{g.name}</b><span className="block text-xs text-slate-500">{g.rows.map(r => r.client_name || 'Unnamed').join(', ')}</span></span><b>{money(g.total)}</b></div>)}
                    <div className="px-4 py-3 flex justify-between font-extrabold text-[#052d4a]"><span>Total</span><span>{money(total)}</span></div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-slate-600">Date paid<input type="date" value={paidOn} max={todaySgt()} onChange={e => setPaidOn(e.target.value)} className={`${FIELD} w-full mt-1 block`} /></label>
                    <label className="text-xs font-semibold text-slate-600">Bank reference (optional)<input value={reference} maxLength={120} onChange={e => setReference(e.target.value)} className={`${FIELD} w-full mt-1 block`} /></label>
                </div>
                {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={onClose} className={`${BTN} text-slate-500`}>Cancel</button>
                    <button type="button" disabled={busy || !paidOn} onClick={save} className={`${BTN} bg-emerald-600 text-white`}>{busy ? <Spinner size="sm" color="white" label="Saving…" /> : `Record ${money(total)}`}</button>
                </div>
            </div>
        </Modal>
    )
}

// ─── Bank payments ───────────────────────────────────────────────────────────

function BankPayments({ rows, onDone }: { rows: QueueRow[]; onDone: (m: string) => void }) {
    const [bank, setBank] = useState('')
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [open, setOpen] = useState(false)
    const banks = [...new Set(rows.map(r => r.bank))].sort()
    const shown = rows.filter(r => !bank || r.bank === bank)
    const chosen = shown.filter(r => picked.has(r.id))
    const differ = rows.filter(r => ['part', 'over'].includes(bankState(r)))
    return (
        <div className="space-y-5 pb-24">
            {differ.length > 0 && <p className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {differ.length} case{differ.length === 1 ? ' doesn’t' : 's don’t'} match the expected 0.15%. The agent&apos;s share isn&apos;t changed automatically.</p>}
            <Panel title="Waiting for bank money" subtitle="Tick the cases one transfer covered, then record it. For a clawback, or to undo a payment, open the case."
                action={<select aria-label="Bank" className={FIELD} value={bank} onChange={e => setBank(e.target.value)}><option value="">All banks</option>{banks.map(b => <option key={b}>{b}</option>)}</select>}>
                {shown.length === 0 ? <Empty>Every bank payment is in.</Empty> : (
                    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                        {shown.map(r => (
                            <label key={r.id} className="flex items-center gap-3 px-4 py-3 flex-wrap text-sm cursor-pointer">
                                <input type="checkbox" className="w-5 h-5 accent-[#052d4a]" disabled={bankOutstanding(r) <= 0} checked={picked.has(r.id)} aria-label={`Select ${r.client_name || 'case'}`}
                                    onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n })} />
                                <CaseInfo r={r} />
                                <span className="text-slate-500">{r.agent_name}</span>
                                <BankPill r={r} />
                                <span className="text-right w-[120px]"><b>{money(Math.max(0, bankOutstanding(r)))}</b><span className="block text-[11px] text-slate-500">{money(r.received)} of {money(r.gross)} in</span></span>
                            </label>
                        ))}
                    </div>
                )}
            </Panel>
            {chosen.length > 0 && (
                <div className="sticky bottom-4 z-30 card p-3 sm:p-4 shadow-xl flex items-center gap-3 flex-wrap">
                    <p className="flex-1 text-sm"><b className="text-lg text-[#052d4a]">{money(chosen.reduce((s, r) => s + bankOutstanding(r), 0))}</b><span className="text-slate-500"> expected · {chosen.length} case{chosen.length === 1 ? '' : 's'}</span></p>
                    <button type="button" onClick={() => setPicked(new Set())} className={`${BTN} text-slate-500`}>Clear</button>
                    <button type="button" onClick={() => setOpen(true)} className={`${BTN} bg-[#052d4a] text-white`}>Record as received</button>
                </div>
            )}
            {open && <ReceiptModal rows={chosen} onClose={() => setOpen(false)} onDone={m => { setOpen(false); setPicked(new Set()); onDone(m) }} />}
        </div>
    )
}

function ReceiptModal({ rows, onClose, onDone }: { rows: QueueRow[]; onClose: () => void; onDone: (m: string) => void }) {
    const [on, setOn] = useState(todaySgt())
    const [reference, setReference] = useState('')
    const [amounts, setAmounts] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(r => [r.id, bankOutstanding(r).toFixed(2)])))
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const total = rows.reduce((s, r) => s + (Number(amounts[r.id]) || 0), 0)
    const valid = rows.every(r => Number(amounts[r.id]) > 0)
    const save = async () => {
        setBusy(true); setErr(null)
        try {
            await postJson('/api/admin/finance/receipts', { kind: 'receipt', receivedOn: on, reference: reference || undefined, items: rows.map(r => ({ caseId: r.id, amount: Number(amounts[r.id]), seen: r.received })) })
            onDone(`Recorded ${money(total)} from the bank.`)
        } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); setBusy(false) }
    }
    return (
        <Modal title="Received from bank" size="lg" onClose={() => { if (!busy) onClose() }}>
            <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {rows.map(r => {
                        const gap = Number(amounts[r.id]) - bankOutstanding(r)
                        return (
                            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 text-sm flex-wrap">
                                <span className="flex-1 min-w-[140px]"><b>{r.client_name || 'Unnamed'}</b><span className="block text-xs text-slate-500">{r.bank} · expected {money(bankOutstanding(r))}</span></span>
                                <span><input aria-label={`Amount for ${r.client_name || 'case'}`} inputMode="decimal" value={amounts[r.id]} onChange={e => setAmounts(a => ({ ...a, [r.id]: e.target.value.replace(/[^\d.]/g, '') }))} className={`${FIELD} w-[130px] text-right`} />
                                    {Math.abs(gap) > 0.005 && Number.isFinite(gap) && <span className="block text-[11px] text-amber-700 text-right">{gap < 0 ? `${money(-gap)} short` : `${money(gap)} extra`}</span>}</span>
                            </div>
                        )
                    })}
                    <div className="px-4 py-3 flex justify-between font-extrabold text-[#052d4a]"><span>Total transfer</span><span>{money(total)}</span></div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-slate-600">Date received<input type="date" value={on} max={todaySgt()} onChange={e => setOn(e.target.value)} className={`${FIELD} w-full mt-1 block`} /></label>
                    <label className="text-xs font-semibold text-slate-600">Bank reference (optional)<input value={reference} maxLength={120} onChange={e => setReference(e.target.value)} className={`${FIELD} w-full mt-1 block`} /></label>
                </div>
                {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" disabled={busy} onClick={onClose} className={`${BTN} text-slate-500`}>Cancel</button>
                    <button type="button" disabled={busy || !valid || !on} onClick={save} className={`${BTN} bg-[#052d4a] text-white`}>{busy ? <Spinner size="sm" color="white" label="Saving…" /> : `Record ${money(total)}`}</button>
                </div>
            </div>
        </Modal>
    )
}

// ─── By agent ────────────────────────────────────────────────────────────────

function ByAgent() {
    const router = useRouter()
    const { data, error } = useGet<{ rows: AgentCommissionRow[] }>('/api/admin/insurance/earnings/by-agent')
    if (error) return <ErrorBox message={error} />
    if (!data) return <Skeleton height={320} radius={14} />
    return <MasterEarningsTable rows={data.rows} onOpen={id => router.push(`/admin/insurance/earnings?agent=${id}`)} />
}

// ─── History ─────────────────────────────────────────────────────────────────

interface HistoryRow {
    id: string; case_id: string; amount: number; paid_on?: string; received_on?: string; reference?: string | null; note?: string | null
    kind?: string; bank?: string | null; batch_id?: string | null; transfer_id?: string; reverses: string | null; reversed: boolean
    bank_transfers?: { reference: string | null; note: string | null } | null
    cases: { client_name: string | null; case_type: string; profiles: { name: string | null } | null }
    recorder: { name: string | null } | null
}

function History({ onDone }: { onDone: (m: string) => void }) {
    const [kind, setKind] = useState<'payouts' | 'receipts'>('payouts')
    const [month, setMonth] = useState('')
    const [agent, setAgent] = useState('')
    const [extra, setExtra] = useState<{ key: string; rows: HistoryRow[] }>({ key: '', rows: [] })
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    const q = new URLSearchParams({ ...(month ? { month } : {}), ...(agent ? { agent } : {}) }).toString()
    const url = `/api/admin/finance/${kind}?${q}`
    const { data, error, reload, loading } = useGet<{ rows: HistoryRow[]; total: number }>(url)
    const { data: people } = useGet<{ rows: AgentCommissionRow[] }>('/api/admin/insurance/earnings/by-agent')
    const rows = loading || !data ? [] : [...data.rows, ...(extra.key === url ? extra.rows : [])]

    const fetchFrom = async (offset: number) => {
        const r = await fetch(`${url}${q ? '&' : ''}offset=${offset}`)
        if (!r.ok) throw new Error('Could not load more.')
        return (await r.json()).rows as HistoryRow[]
    }
    const run = async (fn: () => Promise<void>) => {
        setBusy(true); setErr(null)
        try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
    }
    const more = () => run(async () => { const next = await fetchFrom(rows.length); setExtra(x => ({ key: url, rows: [...(x.key === url ? x.rows : []), ...next] })) })
    const exportAll = () => run(async () => {
        const all = [...rows]
        while (all.length < (data?.total ?? 0)) {
            const next = await fetchFrom(all.length)
            if (!next.length) break
            all.push(...next)
        }
        const out = kind === 'payouts'
            ? [['Date paid', 'Agent', 'Client', 'Case type', 'Amount (SGD)', 'Reference', 'Note', 'Batch', 'Recorded by'], ...all.map(r => [r.paid_on, r.cases.profiles?.name, r.cases.client_name, r.cases.case_type, Number(r.amount), r.reference, r.note, r.batch_id?.slice(0, 8), r.recorder?.name])]
            : [['Date received', 'Bank', 'Agent', 'Client', 'Case type', 'Type', 'Amount (SGD)', 'Reference', 'Recorded by'], ...all.map(r => [r.received_on, r.bank, r.cases.profiles?.name, r.cases.client_name, r.cases.case_type, r.kind, Number(r.amount), r.bank_transfers?.reference, r.recorder?.name])]
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([toCsv(out)], { type: 'text/csv;charset=utf-8' }))
        a.download = `tlc-${kind === 'payouts' ? 'agent-payouts' : 'bank-payments'}-${month || 'all'}.csv`
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    })
    const undo = (r: HistoryRow, batch: boolean) => {
        const what = batch ? 'every payment in this batch' : `this ${money(Math.abs(Number(r.amount)))} ${kind === 'payouts' ? 'payout' : 'bank record'}`
        if (!window.confirm(`Reverse ${what}? The original stays on record.`)) return
        run(async () => {
            if (kind === 'payouts') await postJson('/api/admin/insurance/payouts', batch ? { reverseBatch: r.batch_id } : { reverses: r.id })
            else await postJson('/api/admin/finance/receipts', { reverses: r.id })
            setExtra({ key: '', rows: [] }); reload(); onDone('Reversal recorded.')
        })
    }

    return (
        <Panel title="History" subtitle="Permanent records. A mistake is undone with a reversal, and both stay here."
            action={<button type="button" disabled={busy || !rows.length} onClick={exportAll} className={`${BTN} border border-slate-200 text-slate-600`}><Download size={16} /> Excel (CSV)</button>}>
            <div className="flex gap-2 flex-wrap items-center">
                <Tabs value={kind} onChange={setKind} tabs={[{ key: 'payouts', label: 'To agents' }, { key: 'receipts', label: 'From banks' }]} />
                <input type="month" aria-label="Month" max={todaySgt().slice(0, 7)} value={month} onChange={e => setMonth(e.target.value)} className={FIELD} />
                <select aria-label="Agent" className={FIELD} value={agent} onChange={e => setAgent(e.target.value)}><option value="">All agents</option>{(people?.rows ?? []).map(a => <option key={a.agentId} value={a.agentId}>{a.agentName}</option>)}</select>
                {(month || agent) && <button type="button" onClick={() => { setMonth(''); setAgent('') }} className="text-xs text-slate-500 min-h-[44px] px-2">Clear</button>}
            </div>
            {(err || error) && <p role="alert" className="text-sm text-red-600">{err || error}</p>}
            {loading ? <Skeleton height={220} radius={12} /> : rows.length === 0 ? <Empty>No payments recorded.</Empty> : (
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {rows.map(r => {
                        const amount = Number(r.amount)
                        const canUndo = !r.reversed && !r.reverses
                        return (
                            <div key={r.id} className="px-4 py-3 flex items-center gap-3 text-sm flex-wrap">
                                <span className="text-slate-500 w-[92px] shrink-0">{day(r.paid_on ?? r.received_on)}</span>
                                <span className="flex-1 min-w-[160px]">
                                    <Link href={`/admin/insurance/cases/${r.case_id}`} className="font-semibold text-[#0369a1]">{r.cases.client_name || 'Unnamed'}</Link>
                                    <span className="block text-xs text-slate-500">{[r.cases.profiles?.name, r.bank, r.reference ?? r.bank_transfers?.reference, r.note ?? r.bank_transfers?.note, r.recorder?.name && `by ${r.recorder.name}`].filter(Boolean).join(' · ')}</span>
                                </span>
                                {r.batch_id && <Pill tone="blue">Batch {r.batch_id.slice(0, 4)}</Pill>}
                                {r.reverses ? <Pill tone="red">Reversal</Pill> : r.kind === 'clawback' ? <Pill tone="red">Clawback</Pill> : r.reversed ? <Pill tone="grey">Reversed</Pill> : null}
                                <b className={`w-[100px] text-right ${amount < 0 ? 'text-red-600' : r.reversed ? 'text-slate-400 line-through' : 'text-[#052d4a]'}`}>{money(amount)}</b>
                                <span className="flex gap-1">
                                    {canUndo && <button type="button" disabled={busy} onClick={() => undo(r, false)} className="min-h-[44px] px-2 text-xs font-semibold text-slate-500 hover:text-red-600 inline-flex items-center gap-1"><Undo2 size={13} /> Reverse</button>}
                                    {canUndo && r.batch_id && <button type="button" disabled={busy} onClick={() => undo(r, true)} className="min-h-[44px] px-2 text-xs font-semibold text-slate-500 hover:text-red-600">Whole batch</button>}
                                </span>
                            </div>
                        )
                    })}
                    {rows.length < (data?.total ?? 0) && <button type="button" disabled={busy} onClick={more} className="w-full min-h-[44px] text-sm font-semibold text-[#0369a1]">{busy ? 'Loading…' : `Load more (${(data?.total ?? 0) - rows.length} remaining)`}</button>}
                </div>
            )}
        </Panel>
    )
}
