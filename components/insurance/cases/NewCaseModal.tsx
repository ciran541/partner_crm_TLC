'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import { formatMoneyInput } from '@/lib/utils/formatCurrency'
import { INTAKE_CASE_TYPES, INTAKE_PROPERTY_TYPES } from '@/lib/insurance/caseIntake'
import { CREATABLE_STAGES, INACTIVE_STAGE, stageLabel } from '@/lib/insurance/stages'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { LEAD_SOURCES } from '@/lib/insurance/leadSources'
import type { CaseType, PipelineStage } from '@/lib/types'

/**
 * "+ New Case" — key in a client directly (no workflow). Everything entered also
 * pre-fills the matching workflow, so nothing is typed twice later. Validation
 * is server-side (POST /api/insurance/cases → validateIntake), the same rules
 * the mass upload uses.
 */

interface Form {
    client_name: string
    client_mobile: string
    client_email: string
    case_type: CaseType
    stage: PipelineStage
    loan_amount: string
    current_bank: string
    subsidy: string
    property_address: string
    property_type: string
    remaining_tenure: string
    lock_in_end_date: string
    follow_up_date: string
    remarks: string
    lead_source: string
    lead_source_other: string
}

const blankForm = (keep?: Pick<Form, 'case_type' | 'stage' | 'lead_source'>): Form => ({
    client_name: '', client_mobile: '', client_email: '',
    case_type: keep?.case_type ?? 'Refinancing',
    stage: keep?.stage ?? 'Touched Base',
    loan_amount: '', current_bank: '', subsidy: '', property_address: '', property_type: '',
    remaining_tenure: '', lock_in_end_date: '', follow_up_date: '', remarks: '',
    // Kept for "Save & add another": a batch usually comes from one source.
    lead_source: keep?.lead_source ?? '', lead_source_other: '',
})

const inp = 'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10 bg-white transition-colors'

export default function NewCaseModal({ onClose, onCreated }: {
    onClose: () => void
    onCreated: (id: string) => void
}) {
    const [form, setForm] = useState<Form>(() => blankForm())
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [duplicate, setDuplicate] = useState<{ id: string; name: string | null } | null>(null)
    const [addedCount, setAddedCount] = useState(0)

    const set = <K extends keyof Form>(k: K, v: Form[K]) => {
        setForm(f => ({ ...f, [k]: v }))
        if (k === 'client_mobile') setDuplicate(null)
    }

    async function save(addAnother: boolean, force = false) {
        setSaving(true)
        setError(null)
        try {
            const res = await fetch('/api/insurance/cases', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, force }),
            })
            const json = await res.json().catch(() => ({}))
            if (res.status === 409 && json.existing) { setDuplicate(json.existing); return }
            if (!res.ok) { setError(json.error ?? 'Could not create the case.'); return }

            invalidateCaseData()
            setDuplicate(null)
            if (addAnother) {
                setAddedCount(n => n + 1)
                setForm(f => blankForm({ case_type: f.case_type, stage: f.stage, lead_source: f.lead_source }))
            } else {
                onCreated(json.id)
            }
        } catch {
            setError('Network error — please try again.')
        } finally {
            setSaving(false)
        }
    }

    const canSave = form.client_name.trim() !== '' && form.client_mobile.trim() !== '' && form.lead_source !== '' && !saving
    const sourceInfo = LEAD_SOURCES.find(s => s.value === form.lead_source)

    return (
        <Modal title="New Case" onClose={onClose} size="lg">
            <form
                className="space-y-5"
                onSubmit={e => { e.preventDefault(); if (canSave) save(false) }}
            >
                {addedCount > 0 && (
                    <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                        {addedCount} case{addedCount > 1 ? 's' : ''} added. Keep going, or close when done.
                    </p>
                )}

                {/* Client */}
                <Group title="Client">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Name" required>
                            <input className={inp} value={form.client_name} onChange={e => set('client_name', e.target.value)} placeholder="Tan Wei Ming" autoFocus />
                        </Field>
                        <Field label="Mobile" required>
                            <input className={inp} type="tel" value={form.client_mobile} onChange={e => set('client_mobile', e.target.value)} placeholder="9123 4567" />
                        </Field>
                        <Field label="Email" className="sm:col-span-2">
                            <input className={inp} type="email" value={form.client_email} onChange={e => set('client_email', e.target.value)} placeholder="optional" />
                        </Field>
                    </div>
                </Group>

                {/* Case */}
                <Group title="Case">
                    <Field label="Case Type">
                        <Pills
                            options={INTAKE_CASE_TYPES.map(t => ({ value: t.value, label: t.label }))}
                            value={form.case_type}
                            onChange={v => set('case_type', v as CaseType)}
                        />
                    </Field>
                    <Field label="Stage">
                        <Pills
                            options={CREATABLE_STAGES.map(s => ({ value: s, label: stageLabel(s) }))}
                            value={form.stage}
                            onChange={v => set('stage', v as PipelineStage)}
                        />
                        <p className="text-[11px] text-slate-400 mt-1.5">
                            {form.stage === INACTIVE_STAGE
                                ? 'Kept out of your active cases and revenue. You still get follow-up reminders; switch it to active when it\'s time.'
                                : 'Shows in your active cases.'}
                        </p>
                    </Field>
                    {/* Feeds the Dashboard's lead-source analytics — required. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Lead Source" required>
                            <select className={inp} value={form.lead_source} onChange={e => set('lead_source', e.target.value)}>
                                <option value="" disabled>Where did this lead come from?</option>
                                {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                            {sourceInfo && sourceInfo.value !== 'others' && (
                                <p className="text-[11px] text-slate-400 mt-1">{sourceInfo.includes}</p>
                            )}
                        </Field>
                        {form.lead_source === 'others' && (
                            <Field label="Please specify">
                                <input className={inp} value={form.lead_source_other} maxLength={100}
                                    onChange={e => set('lead_source_other', e.target.value)} placeholder="e.g. Walk-in, flyer" />
                            </Field>
                        )}
                    </div>
                </Group>

                {/* Loan & property */}
                <Group title="Loan & Property">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label={form.case_type === 'Purchase' ? 'Loan Amount' : 'Current Loan Outstanding'}>
                            <Money value={form.loan_amount} onChange={v => set('loan_amount', v)} placeholder="750,000" />
                        </Field>
                        <Field label="Current Bank">
                            <InsuranceBankDropdown value={form.current_bank} onChange={v => set('current_bank', v)} placeholder="Select bank…" />
                        </Field>
                        <Field label="Property Type">
                            <select className={inp} value={form.property_type} onChange={e => set('property_type', e.target.value)}>
                                <option value="">—</option>
                                {INTAKE_PROPERTY_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </Field>
                        <Field label="Remaining Tenure (yrs)">
                            <input className={inp} type="number" min={0} max={35} value={form.remaining_tenure} onChange={e => set('remaining_tenure', e.target.value)} placeholder="22" />
                        </Field>
                        <Field label="Subsidy Received">
                            <Money value={form.subsidy} onChange={v => set('subsidy', v)} placeholder="2,000" />
                        </Field>
                        <Field label="Property Address">
                            <input className={inp} value={form.property_address} onChange={e => set('property_address', e.target.value)} placeholder="optional" />
                        </Field>
                    </div>
                </Group>

                {/* Dates */}
                <Group title="Dates">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Lock-in End Date">
                            <input className={inp} type="date" value={form.lock_in_end_date} onChange={e => set('lock_in_end_date', e.target.value)} />
                        </Field>
                        <Field label="Follow-up Date">
                            <input className={inp} type="date" value={form.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} />
                        </Field>
                    </div>
                </Group>

                <Field label="Remarks">
                    <textarea className={`${inp} min-h-[70px]`} value={form.remarks} onChange={e => set('remarks', e.target.value)} placeholder="optional" />
                </Field>

                {duplicate && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 flex items-start gap-2">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        <div className="space-y-1.5">
                            <p>You already have a case with this mobile{duplicate.name ? ` (${duplicate.name})` : ''}.</p>
                            <div className="flex gap-3">
                                <Link href={`/insurance/dashboard/cases/${duplicate.id}`} className="font-bold underline">Open it</Link>
                                <button type="button" onClick={() => save(false, true)} className="font-bold underline">Create a new case anyway</button>
                            </div>
                        </div>
                    </div>
                )}
                {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button type="button" onClick={onClose} className="text-sm font-semibold text-slate-500 hover:text-slate-700 px-3 py-2">
                        Cancel
                    </button>
                    <button type="button" disabled={!canSave} onClick={() => save(true)}
                        className="text-sm font-semibold px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                        Save &amp; add another
                    </button>
                    <button type="submit" disabled={!canSave} className="btn-primary text-sm px-5 py-2 flex items-center gap-2 disabled:opacity-40">
                        {saving && <Loader2 size={14} className="animate-spin" />} Save case
                    </button>
                </div>
            </form>
        </Modal>
    )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{title}</p>
            {children}
        </div>
    )
}

function Field({ label, required, className = '', children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
    return (
        <div className={className}>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                {label}{required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            {children}
        </div>
    )
}

function Money({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
    return (
        <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400">$</span>
            <input className={`${inp} pl-7`} inputMode="numeric" value={value} onChange={e => onChange(formatMoneyInput(e.target.value))} placeholder={placeholder} />
        </div>
    )
}

function Pills({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
    return (
        <div className="flex flex-wrap gap-1.5">
            {options.map(o => (
                <button key={o.value} type="button" onClick={() => onChange(o.value)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                        value === o.value ? 'bg-[#052d4a] text-white border-[#052d4a]' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                    }`}>
                    {o.label}
                </button>
            ))}
        </div>
    )
}
