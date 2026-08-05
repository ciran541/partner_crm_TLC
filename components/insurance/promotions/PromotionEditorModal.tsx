'use client'

import { useState } from 'react'
import { X, Save, Plus, Trash2, AlertTriangle, Users, Gift } from 'lucide-react'
import {
    BENEFIT_TYPES, WINDOW_BASES,
    type BankPromotionInput, type PromotionTier, type PromotionAudience, type BenefitType, type WindowBasis,
} from '@/lib/types/promotions'
import type { CaseType } from '@/lib/types/insurance'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import Spinner from '@/components/shared/Spinner'

interface Props {
    initial?: BankPromotionInput | null
    defaultBank?: string
    onSave: (input: BankPromotionInput) => Promise<void>
    onClose: () => void
    saving: boolean
}

const inputCls = 'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12'
const smallCls = 'w-full px-2 py-1.5 text-sm rounded-md border border-slate-200 outline-none focus:border-[#03a9e7] tabular-nums'
const labelCls = 'block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5'

const CASE_TYPES: CaseType[] = ['Purchase', 'Refinancing', 'Decouple', 'Equity Loan']

const BENEFIT_LABELS: Record<BenefitType, string> = {
    cash_rebate: 'Cash rebate', referral_bonus: 'Referral bonus', fee_waiver: 'Fee waiver',
    rate_discount: 'Rate discount', other: 'Other',
}
const BASIS_LABELS: Record<WindowBasis, string> = {
    submission: 'Loan submitted within window',
    disbursement: 'Loan disbursed within window',
    acceptance: 'Offer accepted within window',
}

/** A tier row in the editor — kept as strings so a half-typed field doesn't
 *  collapse to 0 while the admin is still typing. */
interface DraftTier { min: string; max: string; value: string; mode: 'amount' | 'percent' }

const toDraft = (t: PromotionTier): DraftTier => ({
    min: t.min_loan ? String(t.min_loan) : '',
    max: t.max_loan != null ? String(t.max_loan) : '',
    value: t.amount != null ? String(t.amount) : t.percent != null ? String(t.percent) : '',
    mode: t.amount != null ? 'amount' : 'percent',
})

const fromDraft = (d: DraftTier): PromotionTier | null => {
    const value = parseFloat(d.value)
    if (!Number.isFinite(value)) return null
    const min = parseFloat(d.min)
    const max = parseFloat(d.max)
    const tier: PromotionTier = {
        min_loan: Number.isFinite(min) ? min : 0,
        max_loan: Number.isFinite(max) ? max : null,
    }
    if (d.mode === 'amount') tier.amount = value
    else tier.percent = value
    return tier
}

export default function PromotionEditorModal({ initial, defaultBank, onSave, onClose, saving }: Props) {
    const [bank, setBank] = useState(initial?.bank ?? defaultBank ?? '')
    const [title, setTitle] = useState(initial?.title ?? '')
    const [audience, setAudience] = useState<PromotionAudience>(initial?.audience ?? 'client')
    const [benefitType, setBenefitType] = useState<BenefitType>(initial?.benefit_type ?? 'cash_rebate')
    const [tiers, setTiers] = useState<DraftTier[]>(
        initial?.benefit_tiers?.length ? initial.benefit_tiers.map(toDraft) : [{ min: '', max: '', value: '', mode: 'amount' }],
    )
    const [appliesTo, setAppliesTo] = useState<CaseType[]>(initial?.applies_to ?? [])
    const [basis, setBasis] = useState<WindowBasis>(initial?.window_basis ?? 'submission')
    const [startsOn, setStartsOn] = useState(initial?.starts_on ?? '')
    const [endsOn, setEndsOn] = useState(initial?.ends_on ?? '')
    const [conditions, setConditions] = useState((initial?.conditions ?? []).join('\n'))
    const [clawback, setClawback] = useState(initial?.clawback_years != null ? String(initial.clawback_years) : '')
    const [affectsLtv, setAffectsLtv] = useState(initial?.affects_ltv ?? false)
    const [notes, setNotes] = useState(initial?.notes ?? '')
    const [status, setStatus] = useState<'published' | 'draft'>(initial?.status ?? 'draft')

    const updateTier = (i: number, patch: Partial<DraftTier>) =>
        setTiers(ts => ts.map((t, idx) => idx === i ? { ...t, ...patch } : t))

    const toggleCase = (c: CaseType) =>
        setAppliesTo(list => list.includes(c) ? list.filter(x => x !== c) : [...list, c])

    // Sorted ascending on save so the first-match tier rule is predictable
    // regardless of the order the rows were typed in.
    const handleSubmit = () => {
        const built = tiers.map(fromDraft).filter((t): t is PromotionTier => t !== null)
            .sort((a, b) => a.min_loan - b.min_loan)
        onSave({
            bank: bank.trim(),
            title: title.trim(),
            audience,
            benefit_type: benefitType,
            benefit_tiers: built,
            applies_to: appliesTo,
            window_basis: basis,
            starts_on: startsOn || null,
            ends_on: endsOn || null,
            conditions: conditions.split('\n').map(c => c.trim()).filter(Boolean),
            clawback_years: clawback.trim() ? Math.round(Number(clawback)) || null : null,
            affects_ltv: affectsLtv,
            source_text: initial?.source_text ?? null,
            notes: notes.trim() || null,
            status,
        })
    }

    const canSave = !!bank.trim() && !!title.trim() && !saving

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 className="text-lg font-bold text-[#052d4a]">{initial ? 'Edit promotion' : 'Add promotion'}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Bank *</label>
                            <InsuranceBankDropdown value={bank} onChange={setBank} />
                        </div>
                        <div>
                            <label className={labelCls}>Title *</label>
                            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="National Day Cash Rebate" />
                        </div>
                    </div>

                    {/* Audience — the field that decides whether this can ever reach a client. */}
                    <div>
                        <label className={labelCls}>Who receives this? *</label>
                        <div className="grid sm:grid-cols-3 gap-2">
                            {([
                                { v: 'client', label: 'The client', hint: 'Cash rebate, waived fee', icon: Gift },
                                { v: 'agent', label: 'The agent', hint: 'Referral fee, commission', icon: Users },
                                { v: 'both', label: 'Both', hint: 'Rare', icon: Gift },
                            ] as const).map(o => (
                                <button key={o.v} type="button" onClick={() => setAudience(o.v)}
                                    className={`text-left px-3 py-2 rounded-lg border transition-all ${
                                        audience === o.v ? 'border-[#03a9e7] bg-sky-50 ring-2 ring-[#03a9e7]/12' : 'border-slate-200 hover:border-slate-300'}`}>
                                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-[#052d4a]">
                                        <o.icon size={13} className="text-slate-400" />{o.label}
                                    </span>
                                    <span className="block text-[11px] text-slate-400 mt-0.5">{o.hint}</span>
                                </button>
                            ))}
                        </div>
                        {audience !== 'client' && (
                            <p className="text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-md px-2 py-1.5 mt-2 flex items-start gap-1.5">
                                <Users size={11} className="mt-0.5 shrink-0" />
                                Agent-facing benefits are marked internal and are excluded from anything a client sees.
                            </p>
                        )}
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Benefit type</label>
                            <select value={benefitType} onChange={e => setBenefitType(e.target.value as BenefitType)} className={inputCls}>
                                {BENEFIT_TYPES.map(b => <option key={b} value={b}>{BENEFIT_LABELS[b]}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Window measured on</label>
                            <select value={basis} onChange={e => setBasis(e.target.value as WindowBasis)} className={inputCls}>
                                {WINDOW_BASES.map(b => <option key={b} value={b}>{BASIS_LABELS[b]}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Tiers */}
                    <div>
                        <label className={labelCls}>Benefit by loan size</label>
                        <div className="space-y-2">
                            {tiers.map((t, i) => (
                                <div key={i} className="flex items-end gap-2 rounded-lg border border-slate-200 p-2">
                                    <div className="flex-1 min-w-0">
                                        <span className="block text-[10px] text-slate-400 mb-0.5">Min loan</span>
                                        <input value={t.min} onChange={e => updateTier(i, { min: e.target.value })} className={smallCls} placeholder="1000000" inputMode="numeric" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className="block text-[10px] text-slate-400 mb-0.5">Max loan</span>
                                        <input value={t.max} onChange={e => updateTier(i, { max: e.target.value })} className={smallCls} placeholder="no cap" inputMode="numeric" />
                                    </div>
                                    <div className="w-[92px] shrink-0">
                                        <span className="block text-[10px] text-slate-400 mb-0.5">{t.mode === 'amount' ? 'Amount $' : 'Percent %'}</span>
                                        <input value={t.value} onChange={e => updateTier(i, { value: e.target.value })} className={smallCls} placeholder={t.mode === 'amount' ? '800' : '0.2'} inputMode="decimal" />
                                    </div>
                                    <button type="button" onClick={() => updateTier(i, { mode: t.mode === 'amount' ? 'percent' : 'amount' })}
                                        title="Switch between a flat amount and a percentage of the loan"
                                        className="shrink-0 px-2 py-1.5 text-[11px] font-semibold rounded-md border border-slate-200 text-slate-500 hover:border-[#03a9e7] hover:text-[#03a9e7]">
                                        {t.mode === 'amount' ? '$' : '%'}
                                    </button>
                                    <button type="button" onClick={() => setTiers(ts => ts.filter((_, idx) => idx !== i))} disabled={tiers.length === 1}
                                        className="shrink-0 p-1.5 text-slate-400 hover:text-red-500 rounded-md disabled:opacity-30"><Trash2 size={14} /></button>
                                </div>
                            ))}
                        </div>
                        <button type="button" onClick={() => setTiers(ts => [...ts, { min: '', max: '', value: '', mode: 'amount' }])}
                            className="mt-2 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] flex items-center gap-1">
                            <Plus size={13} /> Add tier
                        </button>
                        <p className="text-[11px] text-slate-400 mt-1.5">
                            Leave both loan fields blank for a benefit with no loan-size condition. Where two tiers meet, the lower one wins.
                        </p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Opens</label>
                            <input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Closes</label>
                            <input type="date" value={endsOn} onChange={e => setEndsOn(e.target.value)} className={inputCls} />
                        </div>
                    </div>

                    <div>
                        <label className={labelCls}>Applies to</label>
                        <div className="flex flex-wrap gap-2">
                            {CASE_TYPES.map(c => (
                                <button key={c} type="button" onClick={() => toggleCase(c)}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                                        appliesTo.includes(c) ? 'bg-[#052d4a] text-white border-[#052d4a]' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}>
                                    {c}
                                </button>
                            ))}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1.5">Select none to apply to every case type.</p>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Clawback (years)</label>
                            <input value={clawback} onChange={e => setClawback(e.target.value)} className={inputCls} placeholder="3" inputMode="numeric" />
                        </div>
                        <div className="flex items-end pb-1">
                            <label className="flex items-start gap-2 text-[13px] text-slate-600 cursor-pointer">
                                <input type="checkbox" checked={affectsLtv} onChange={e => setAffectsLtv(e.target.checked)} className="accent-[#03a9e7] mt-0.5" />
                                <span>Netted off the price for LTV
                                    <span className="block text-[11px] text-slate-400">Shown as a warning; not auto-applied to the calculation.</span>
                                </span>
                            </label>
                        </div>
                    </div>

                    <div>
                        <label className={labelCls}>Conditions (one per line)</label>
                        <textarea value={conditions} onChange={e => setConditions(e.target.value)} rows={5} className={`${inputCls} resize-y`}
                            placeholder={'Only applicable for loans submitted 3–16 Aug\nCredited within 1 week of disbursement\nOn top of the normal subsidy'} />
                    </div>

                    <div>
                        <label className={labelCls}>Internal notes</label>
                        <input value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} placeholder="Optional — never shown to agents" />
                    </div>

                    {audience !== 'agent' && !endsOn && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-start gap-1.5">
                            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                            No closing date — this will keep showing to agents until someone removes it.
                        </p>
                    )}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-between items-center shrink-0 bg-slate-50/50">
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={status === 'published'} onChange={e => setStatus(e.target.checked ? 'published' : 'draft')} className="accent-[#03a9e7]" />
                        Publish to agents
                    </label>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                        <button onClick={handleSubmit} disabled={!canSave} className="btn-primary px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
                            {saving ? <Spinner size="sm" color="white" /> : <><Save size={15} /> Save</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
