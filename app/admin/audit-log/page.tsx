'use client'

import { useState } from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { ChangeList, type AdminEdit } from '@/components/insurance/cases/CaseChanges'
import { caseFieldValue } from '@/lib/insurance/caseFields'
import { PLAN_NAMES } from '@/lib/permissions'
import { Empty, ErrorBox, FIELD, PageTitle, Pill, day, money, useGet, when } from '@/components/admin/ui'

interface Entry {
    id: string; created_at: string; actor_id: string | null; actor_name: string; kind: 'user' | 'case' | 'payout' | 'bank'; action: string
    case_id: string | null; subject: string | null; amount: number | null; details: Record<string, unknown> | null
}

const ACTIONS: Record<string, string> = {
    user_created: 'User created', user_updated: 'User updated', password_reset: 'Password reset', invite_created: 'Invite created', invite_revoked: 'Invite revoked',
    admin_edit: 'Case edited', correction: 'Correction', stage_change: 'Stage changed', commission_status_change: 'Payout status changed',
    payout_recorded: 'Agent paid', payout_reversed: 'Payout reversed', bank_receipt: 'Received from bank', bank_clawback: 'Bank clawback', bank_reversal: 'Bank record reversed',
}
const TONE = { user: 'grey', case: 'blue', payout: 'green', bank: 'amber' } as const
const WORDS: Record<string, string> = { app_type: 'plan', subscription_tier: 'plan', initial_status: 'status', invited_email: 'email', invited_name: 'name' }

/** User-admin details in plain words: plan names, never stored codes. */
function plain(key: string, v: unknown): string {
    if (key === 'app_type') return v === 'insurance' ? PLAN_NAMES.insurance : `${PLAN_NAMES.propertyPremium} or ${PLAN_NAMES.propertyStandard}`
    if (key === 'subscription_tier') return v === 'premium' ? PLAN_NAMES.propertyPremium : PLAN_NAMES.propertyStandard
    if (key === 'role') return v === 'agent' ? 'Agent' : 'Admin'
    return caseFieldValue(v)
}

/** Everything admins did: user changes, case edits, payouts and bank payments. */
export default function AuditLogPage() {
    const [kind, setKind] = useState('')
    const [actor, setActor] = useState('')
    const [from, setFrom] = useState('')
    const [to, setTo] = useState('')
    const [more, setMore] = useState<{ key: string; rows: Entry[] }>({ key: '', rows: [] })
    const [busy, setBusy] = useState(false)
    const [moreErr, setMoreErr] = useState<string | null>(null)
    const q = new URLSearchParams(Object.entries({ kind, actor, from, to }).filter(([, v]) => v)).toString()
    const url = `/api/admin/audit-log?${q}`
    const { data, error, loading } = useGet<{ total: number; rows: Entry[] }>(url)
    const { data: people } = useGet<{ id: string; name: string; role: string }[]>('/api/admin/get-profiles')
    const rows = loading || !data ? [] : [...data.rows, ...(more.key === url ? more.rows : [])]

    const loadMore = async () => {
        setBusy(true); setMoreErr(null)
        try {
            const r = await fetch(`${url}&offset=${rows.length}`)
            if (!r.ok) throw new Error()
            const d = await r.json()
            setMore(m => ({ key: url, rows: [...(m.key === url ? m.rows : []), ...d.rows] }))
        } catch { setMoreErr('Could not load more.') }
        setBusy(false)
    }

    return (
        <div className="space-y-5">
            <PageTitle icon={History} title="Audit Log" subtitle="Everything admins did, newest first. Payment records can't be edited or deleted." />
            <div className="flex flex-wrap gap-2">
                <select aria-label="Type" className={FIELD} value={kind} onChange={e => setKind(e.target.value)}><option value="">Everything</option><option value="payout">Agent payouts</option><option value="bank">Bank payments</option><option value="case">Case edits</option><option value="user">Users and invites</option></select>
                <select aria-label="Admin" className={FIELD} value={actor} onChange={e => setActor(e.target.value)}><option value="">Any admin</option>{(people ?? []).filter(p => p.role !== 'agent').map(p => <option key={p.id} value={p.id}>{p.name || 'Unnamed'}</option>)}</select>
                <input type="date" aria-label="From" className={FIELD} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
                <input type="date" aria-label="To" className={FIELD} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
                {q && <button type="button" onClick={() => { setKind(''); setActor(''); setFrom(''); setTo('') }} className="min-h-[44px] px-2 text-xs text-slate-500">Clear filters</button>}
            </div>
            {error ? <ErrorBox message={error} /> : loading || !data ? <Skeleton height={320} radius={14} /> : rows.length === 0 ? <div className="card"><Empty>Nothing recorded.</Empty></div> : (
                <div className="card divide-y divide-slate-100">
                    {rows.map(e => (
                        <div key={`${e.kind}-${e.id}`} className="px-4 py-3 flex gap-3 flex-wrap text-sm">
                            <div className="w-[170px] shrink-0"><p className="font-semibold text-slate-700">{e.actor_name}</p><p className="text-xs text-slate-500">{when(e.created_at)}</p></div>
                            <div className="flex-1 min-w-[220px] text-slate-700 space-y-0.5">
                                <p className="flex items-center gap-2 flex-wrap"><Pill tone={TONE[e.kind]}>{ACTIONS[e.action] ?? e.action.replace(/_/g, ' ')}</Pill>
                                    {e.case_id ? <Link href={`/admin/insurance/cases/${e.case_id}`} className="font-semibold text-[#0369a1]">{e.subject || 'Unnamed case'}</Link> : e.subject && <span className="font-semibold">{e.subject}</span>}
                                    {e.amount != null && <b className={Number(e.amount) < 0 ? 'text-red-600' : ''}>{money(Number(e.amount))}</b>}</p>
                                <div className="text-xs text-slate-500"><Details e={e} /></div>
                            </div>
                        </div>
                    ))}
                    {moreErr && <p className="px-4 py-2 text-sm text-red-600">{moreErr}</p>}
                    {rows.length < data.total && <button type="button" disabled={busy} onClick={loadMore} className="w-full min-h-[48px] text-sm font-semibold text-[#0369a1]">{busy ? 'Loading…' : `Load more (${data.total - rows.length} remaining)`}</button>}
                </div>
            )}
        </div>
    )
}

function Details({ e }: { e: Entry }) {
    const d = e.details ?? {}
    if (e.kind === 'payout') return <>{[`paid ${day(d.paid_on as string)}`, d.reference, d.batch && `batch ${String(d.batch).slice(0, 4)}`].filter(Boolean).join(' · ')}</>
    if (e.kind === 'bank') return <>{[d.bank, day(d.received_on as string)].filter(Boolean).join(' · ')}</>
    if (e.kind === 'case') {
        const to = d.to
        if (to && typeof to === 'object') return <ChangeList edit={to as AdminEdit} />
        return <>{caseFieldValue(d.from)} → {caseFieldValue(to)}</>
    }
    const parts = Object.entries(d).filter(([, v]) => v != null && typeof v !== 'object')
    return <>{parts.map(([k, v]) => `${WORDS[k] ?? k.replace(/_/g, ' ')}: ${plain(k, v)}`).join(' · ')}</>
}
