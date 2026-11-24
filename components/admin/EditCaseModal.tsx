'use client'

import { useState } from 'react'
import { AlertTriangle, Trash2, Upload } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import Spinner from '@/components/shared/Spinner'
import BankDropdown from '@/components/insurance/BankDropdown'
import BankerMultiSelect from '@/components/insurance/BankerMultiSelect'
import RateScheduleEditor from '@/components/insurance/RateScheduleEditor'
import { FIELD, money, postJson } from '@/components/admin/ui'
import { supabase } from '@/lib/supabase/client'
import { loanSpecsFor } from '@/lib/insurance/closedWon'
import { CORRECTION_FEE, caseLoanBase, commissionWithFee } from '@/lib/insurance/commission'
import { LEAD_SOURCES } from '@/lib/insurance/leadSources'
import { INACTIVE_STAGE, OPEN_STAGES, stageLabel } from '@/lib/insurance/stages'
import type { Case, CaseType, ClosedLoanKind, LoDocument } from '@/lib/types'
import type { RateScheduleEntry } from '@/lib/types/rates'

const TYPES: CaseType[] = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan', 'Divorce']
const MINOR = ['client_name', 'client_mobile', 'client_email', 'lead_source', 'lead_source_other', 'referred_bankers', 'follow_up_date', 'follow_up_remark', 'remarks']

type Form = Record<string, string>
const TEXT = ['client_name', 'client_mobile', 'client_email', 'lead_source', 'lead_source_other', 'follow_up_remark', 'remarks', 'property_type', 'property_address', 'current_bank', 'subsidy_provided', 'case_type', 'stage'] as const
const DATES = ['follow_up_date', 'lock_in_end_date', 'clawback_end_date'] as const
const NUMS = ['loan_size', 'existing_loan_amount', 'property_price'] as const

/**
 * Admin fixes an agent's case. Only fields that changed are sent. Changing
 * anything beyond client / follow-up details needs a reason the agent will see.
 * The server re-checks every rule (PATCH /api/admin/insurance/cases/[id]).
 */
export default function EditCaseModal({ c, onClose, onSaved }: { c: Case; onClose: () => void; onSaved: (c: Case) => void }) {
    const closed = c.stage === 'Closed Won'
    const closable = closed || c.stage === 'Closed Lost'
    const cw = c.closed_won_data ?? {}
    const rec = c as unknown as Record<string, unknown>
    const [initial] = useState<Form>(() => {
        const f: Form = {}
        for (const k of [...TEXT, ...NUMS]) f[k] = rec[k] == null ? '' : String(rec[k])
        for (const k of DATES) f[k] = String(rec[k] ?? '').slice(0, 10)
        return f
    })
    const [f, setF] = useState<Form>(initial)
    const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))
    const [bankers, setBankers] = useState(c.referred_bankers ?? [])

    const [loans, setLoans] = useState<Record<string, { amount: string; tenure: string }>>(() =>
        Object.fromEntries((cw.loans ?? []).map(l => [l.kind, { amount: String(l.amount), tenure: String(l.tenure) }])))
    const [lockin, setLockin] = useState(cw.package?.lockin_years != null ? String(cw.package.lockin_years) : '')
    const [schedule, setSchedule] = useState<RateScheduleEntry[]>(cw.package?.schedule ?? [])
    const [bank, setBank] = useState(cw.bank ?? '')
    const [address, setAddress] = useState(cw.property_address ?? '')
    const [docs, setDocs] = useState<LoDocument[]>(cw.lo_documents ?? [])
    const [closingTouched, setClosingTouched] = useState(false)
    const touch = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { setClosingTouched(true); fn(...a) }

    const [reason, setReason] = useState('')
    const [charge, setCharge] = useState(false)
    const [busy, setBusy] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const specs = loanSpecsFor(f.case_type as CaseType)
    const typeChanged = f.case_type !== initial.case_type
    const changes: Record<string, unknown> = {}
    for (const k of TEXT) if (f[k].trim() !== initial[k].trim()) changes[k] = f[k].trim() || null
    for (const k of DATES) if (f[k] !== initial[k]) changes[k] = f[k] || null
    for (const k of NUMS) if (f[k] !== initial[k]) changes[k] = f[k] === '' ? null : Number(f[k])
    if (JSON.stringify(bankers) !== JSON.stringify(c.referred_bankers ?? [])) changes.referred_bankers = bankers

    const sendClosing = closed && (closingTouched || typeChanged)
    const loanList = specs.filter(s => loans[s.kind]).map(s => ({ kind: s.kind as ClosedLoanKind, amount: Number(loans[s.kind].amount), tenure: Number(loans[s.kind].tenure) }))
    const major = sendClosing || Object.keys(changes).some(k => !MINOR.includes(k))
    const dirty = sendClosing || charge || Object.keys(changes).length > 0

    // What the agent will be paid, before and after.
    const fee = Number(c.correction_fee ?? 0)
    const before = commissionWithFee(caseLoanBase(c), fee).agent
    const after = commissionWithFee(
        sendClosing && loanList.length ? loanList.reduce((s, l) => s + (l.amount || 0), 0)
            : caseLoanBase({ ...c, ...(changes as Partial<Case>) } as Case),
        fee + (charge ? CORRECTION_FEE : 0),
    ).agent
    const moves = Math.abs(after - before) > 0.005
    const paid = Number(c.commission_paid_total ?? 0) !== 0

    const problem = !f.client_name.trim() ? 'Client name is required.'
        : changes.follow_up_date === null ? 'A follow-up date is required.'
            : sendClosing && specs.some(s => s.required && !loans[s.kind]) ? 'Add the required loan.'
                : sendClosing && (!loanList.length || loanList.some(l => !(l.amount > 0) || !Number.isInteger(l.tenure) || l.tenure <= 0)) ? 'Enter an amount and whole years for each loan.'
                    : paid && moves && closed ? 'This case has been paid. Reverse the payout before changing the amount.'
                        : (major || charge) && !reason.trim() ? 'Give a reason. The agent will see it.' : null

    const upload = async (file: File) => {
        setUploading(true); setErr(null)
        try {
            const u = await postJson<{ path: string; token: string }>(`/api/admin/insurance/cases/${c.id}/upload-url`, { type: file.type })
            const { error } = await supabase.storage.from('insurance-documents').uploadToSignedUrl(u.path, u.token, file)
            if (error) throw new Error('The upload failed. Please try again.')
            setClosingTouched(true)
            setDocs(d => [...d, { path: u.path, name: file.name, type: file.type, uploaded_at: new Date().toISOString() }])
        } catch (e) { setErr(e instanceof Error ? e.message : 'The upload failed.') }
        finally { setUploading(false) }
    }

    const save = async () => {
        setBusy(true); setErr(null)
        try {
            onSaved(await postJson<Case>(`/api/admin/insurance/cases/${c.id}`, {
                updated_at: c.updated_at, changes, reason: reason.trim() || undefined, charge,
                ...(sendClosing ? { closing: { loans: loanList, lockin_years: Number(lockin) || 0, schedule, bank, property_address: address, lo_documents: docs } } : {}),
            }, 'PATCH'))
        } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); setBusy(false) }
    }

    const input = (k: string, label: string, type = 'text') => (
        <label className="block text-xs font-semibold text-slate-600">{label}
            <input type={type === 'money' ? 'text' : type} inputMode={type === 'money' ? 'decimal' : undefined} value={f[k]}
                onChange={e => set(k, type === 'money' ? e.target.value.replace(/[^\d.]/g, '') : e.target.value)} className={`${FIELD} w-full mt-1 block font-normal`} />
        </label>
    )
    const H = ({ children }: { children: React.ReactNode }) => <p className="text-xs font-bold text-slate-500 uppercase tracking-wide pt-2">{children}</p>

    return (
        <Modal title={`Edit case · ${c.client_name || 'Unnamed'}`} size="lg" onClose={() => { if (!busy && (!dirty || window.confirm('Discard your changes?'))) onClose() }}>
            <div className="space-y-3">
                {H({ children: 'Client' })}
                <div className="grid sm:grid-cols-2 gap-3">
                    {input('client_name', 'Name')}{input('client_mobile', 'Mobile')}{input('client_email', 'Email', 'email')}
                    <label className="block text-xs font-semibold text-slate-600">Lead source
                        <select value={f.lead_source} onChange={e => set('lead_source', e.target.value)} className={`${FIELD} w-full mt-1 block font-normal`}><option value="">Not set</option>{LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
                    </label>
                    {f.lead_source === 'others' && input('lead_source_other', 'Other source')}
                </div>
                <div><p className="text-xs font-semibold text-slate-600 mb-1">Bankers</p><BankerMultiSelect value={bankers} onChange={setBankers} /></div>

                {H({ children: 'Follow-up' })}
                <div className="grid sm:grid-cols-2 gap-3">{input('follow_up_date', 'Next follow-up', 'date')}{input('follow_up_remark', 'Remark')}</div>
                {input('remarks', 'Case remarks')}

                {H({ children: 'Case and loan' })}
                <div className="grid sm:grid-cols-2 gap-3">
                    <label className="block text-xs font-semibold text-slate-600">Case type
                        <select value={f.case_type} onChange={e => set('case_type', e.target.value)} className={`${FIELD} w-full mt-1 block font-normal`}>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
                    </label>
                    {closed ? <p className="text-xs text-slate-500 self-end pb-3">Closed Won: use &ldquo;Send back to agent&rdquo; to reopen it.</p> : (
                        <label className="block text-xs font-semibold text-slate-600">Stage
                            <select value={f.stage} onChange={e => set('stage', e.target.value)} className={`${FIELD} w-full mt-1 block font-normal`}>
                                {closable && <option value={c.stage}>{stageLabel(c.stage)}</option>}
                                {[INACTIVE_STAGE, ...OPEN_STAGES].map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
                            </select>
                        </label>
                    )}
                    {input('loan_size', 'Loan amount', 'money')}{input('existing_loan_amount', 'Existing loan', 'money')}
                    {input('property_price', 'Property price', 'money')}{input('property_type', 'Property type')}
                    {input('current_bank', 'Current bank')}{input('lock_in_end_date', 'Lock-in end', 'date')}
                </div>

                {closed && <>
                    {H({ children: 'Closed Won details' })}
                    {specs.map(s => (
                        <div key={s.kind} className="rounded-xl border border-slate-200 p-3">
                            <label className="flex items-center gap-2 text-sm font-semibold min-h-[32px]">
                                <input type="checkbox" className="w-5 h-5" checked={!!loans[s.kind]} onChange={touch(e => setLoans(l => { const n = { ...l }; if (e.target.checked) n[s.kind] = { amount: '', tenure: '' }; else delete n[s.kind]; return n }))} />{s.label}
                            </label>
                            {loans[s.kind] && <div className="grid grid-cols-2 gap-3 mt-2">
                                {(['amount', 'tenure'] as const).map(k => <label key={k} className="text-xs font-semibold text-slate-600">{k === 'amount' ? 'Loan amount' : 'Tenure (years)'}
                                    <input inputMode="decimal" value={loans[s.kind][k]} onChange={touch(e => setLoans(l => ({ ...l, [s.kind]: { ...l[s.kind], [k]: e.target.value.replace(/[^\d.]/g, '') } })))} className={`${FIELD} w-full mt-1 block font-normal`} /></label>)}
                            </div>}
                        </div>
                    ))}
                    <div className="grid sm:grid-cols-2 gap-3">
                        <div><p className="text-xs font-semibold text-slate-600 mb-1">Bank</p><BankDropdown value={bank} onChange={touch(setBank)} /></div>
                        <label className="text-xs font-semibold text-slate-600">Lock-in (years)<input inputMode="decimal" value={lockin} onChange={touch(e => setLockin(e.target.value.replace(/[^\d.]/g, '')))} className={`${FIELD} w-full mt-1 block font-normal`} /></label>
                    </div>
                    <label className="block text-xs font-semibold text-slate-600">Property address<input value={address} onChange={touch(e => setAddress(e.target.value))} className={`${FIELD} w-full mt-1 block font-normal`} /></label>
                    <RateScheduleEditor schedule={schedule} onChange={touch(setSchedule)} />
                    <div className="grid sm:grid-cols-2 gap-3">{input('subsidy_provided', 'Subsidy')}{input('clawback_end_date', 'Clawback end', 'date')}</div>
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-600">Letter of Offer</p>
                        {docs.map(d => <div key={d.path} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{d.name}</span><button type="button" aria-label={`Remove ${d.name}`} onClick={touch(() => setDocs(x => x.filter(y => y.path !== d.path)))} className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-red-600"><Trash2 size={16} /></button></div>)}
                        <label className="min-h-[44px] px-4 rounded-xl border border-dashed border-slate-300 text-sm font-semibold text-slate-600 inline-flex items-center gap-2 cursor-pointer">
                            <Upload size={16} /> {uploading ? 'Uploading…' : 'Add a file'}
                            <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) upload(file) }} />
                        </label>
                    </div>
                </>}

                {(major || charge || closed) && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                        <label className="block text-xs font-semibold text-amber-900">Reason {major || charge ? '(the agent sees this)' : '(optional)'}
                            <textarea value={reason} maxLength={2000} rows={2} onChange={e => setReason(e.target.value)} className="w-full mt-1 block rounded-lg border border-amber-200 bg-white p-3 text-sm font-normal text-slate-700" />
                        </label>
                        {closed && <label className="flex items-center gap-2 text-sm text-amber-900"><input type="checkbox" className="w-5 h-5" checked={charge} onChange={e => setCharge(e.target.checked)} /> Deduct the ${CORRECTION_FEE} correction fee from the agent</label>}
                        {moves && <p className="text-sm font-semibold text-amber-900 flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" /> {closed ? 'Agent share' : 'Potential agent share'} changes from {money(before)} to {money(after)}.</p>}
                    </div>
                )}
                {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
                {dirty && problem && <p className="text-sm text-slate-500">{problem}</p>}
                <div className="flex justify-end gap-2 pt-2">
                    <button type="button" disabled={busy} onClick={onClose} className="min-h-[44px] px-4 text-sm font-semibold text-slate-500">Cancel</button>
                    <button type="button" disabled={busy || uploading || !dirty || !!problem} onClick={save} className="min-h-[44px] px-5 rounded-xl bg-[#052d4a] text-white text-sm font-bold disabled:opacity-40">{busy ? <Spinner size="sm" color="white" label="Saving…" /> : 'Save changes'}</button>
                </div>
            </div>
        </Modal>
    )
}
