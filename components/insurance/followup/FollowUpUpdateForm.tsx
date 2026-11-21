'use client'

import { useState, type ReactNode } from 'react'
import { Check, X, Mail } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { autoRemark, addDays, addMonths } from '@/lib/insurance/followUps'
import { todaySgt } from '@/lib/insurance/promotions'
import { INACTIVE_STAGE, OPEN_STAGES, stageLabel } from '@/lib/insurance/stages'
import type { Case } from '@/lib/types'

/**
 * "Update follow-up" — status, next date and remark in one step.
 *
 * The habit HUB is building: every touch ends by setting the NEXT follow-up.
 * There's no "Mark done" — saving always needs a date, except Closed Lost with
 * "Don't follow up". The remark pre-fills from the status and follows it when
 * the status changes, until the agent types their own.
 *
 * Saves through PATCH /api/insurance/cases/[id]/followup (also syncs Google
 * Calendar; the DB keeps the history). Used inline in the Action Centre and
 * in a modal on the case page.
 */

export type FollowUpCase = Pick<Case,
    'id' | 'stage' | 'client_name' | 'client_email' | 'client_mobile' |
    'follow_up_date' | 'follow_up_remark' | 'no_follow_up' | 'client_reminder_opt_in'>

export type FollowUpSaved = Pick<Case, 'id' | 'stage' | 'follow_up_date' | 'follow_up_remark' | 'no_follow_up' | 'client_reminder_opt_in' | 'referred_bankers'>

const MOVABLE: string[] = [INACTIVE_STAGE, ...OPEN_STAGES]

function stageOptions(current: string): string[] {
    if (current === 'Closed Won') return ['Closed Won']
    if (current === 'Closed Lost') return ['Closed Lost', ...MOVABLE]
    return MOVABLE.includes(current) ? MOVABLE : [current, ...MOVABLE]
}

export default function FollowUpUpdateForm({
    c, presetStage, allowStageChange = true, title, extra, extraBody, onSaved, onCancel,
}: {
    c: FollowUpCase
    /** Open with the status already moved (case page: the agent just picked a new stage). */
    presetStage?: string
    allowStageChange?: boolean
    title?: string
    /** Extra fields rendered above the buttons and sent with the save (e.g. bankers). */
    extra?: ReactNode
    extraBody?: Record<string, unknown>
    onSaved: (saved: FollowUpSaved) => void
    onCancel: () => void
}) {
    const today = todaySgt()
    const [stage, setStage] = useState(presetStage ?? c.stage)
    const stageMoved = stage !== c.stage

    // Keep a still-future date when only editing; a due/overdue one needs a NEW date.
    // Starting date:
    //  - Moving stage (Track drag / Move / case page): carry the case's current
    //    follow-up over, so a quick move is one tap on Save. If it's already
    //    overdue it can't be kept, so it starts at today (noted under the field).
    //  - Plain "Update FU" (the follow-up was just done): a due/overdue date is
    //    cleared so the agent sets the NEXT one; a still-future date is kept.
    const current = c.follow_up_date?.slice(0, 10)
    const carriedOverdue = stageMoved && !!current && current < today
    const initialDate = stageMoved
        ? (current ? (current < today ? today : current) : '')
        : (current && current > today ? current : '')
    const [date, setDate] = useState(initialDate)
    const [remark, setRemark] = useState(
        !stageMoved && c.follow_up_remark ? c.follow_up_remark : autoRemark(stage),
    )
    const [remarkEdited, setRemarkEdited] = useState(false)
    const [noFollowUp, setNoFollowUp] = useState(!!c.no_follow_up && stage === 'Closed Lost')
    const [optIn, setOptIn] = useState(!!c.client_reminder_opt_in)
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const changeStage = (s: string) => {
        setStage(s)
        if (!remarkEdited) setRemark(autoRemark(s))
        if (s !== 'Closed Lost') setNoFollowUp(false)
    }

    const reachable = !!(c.client_email?.trim() || c.client_mobile?.trim())
    const canSave = !saving && (noFollowUp || (!!date && date >= today))

    const quick: { label: string; value: string }[] = stage === 'Closed Won' || stage === 'Closed Lost'
        ? [
            { label: '6 months', value: addMonths(today, 6) },
            { label: '1 year', value: addMonths(today, 12) },
            { label: '2 years', value: addMonths(today, 24) },
        ]
        : [
            { label: 'Tomorrow', value: addDays(today, 1) },
            { label: '3 days', value: addDays(today, 3) },
            { label: '1 week', value: addDays(today, 7) },
            { label: '2 weeks', value: addDays(today, 14) },
        ]

    const save = async () => {
        if (!canSave) return
        setSaving(true); setErr(null)
        try {
            const res = await fetch(`/api/insurance/cases/${c.id}/followup`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    follow_up_date: noFollowUp ? null : date,
                    follow_up_remark: remark,
                    ...(stageMoved ? { stage } : {}),
                    ...(stage === 'Closed Lost' ? { no_follow_up: noFollowUp } : {}),
                    ...(stage === 'Closed Won' ? { client_reminder_opt_in: optIn } : {}),
                    ...extraBody,
                }),
            })
            const d = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(d.error || 'Could not save the follow-up')
            onSaved(d.case as FollowUpSaved)
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Could not save the follow-up')
            setSaving(false)
        }
    }

    const label = 'block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5'
    const input = 'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/15'

    return (
        <div className="space-y-4">
            {title && <p className="text-sm font-bold text-[#052d4a]">{title}</p>}

            {allowStageChange && (
                <div>
                    <label className={label}>Case status</label>
                    <select value={stage} onChange={e => changeStage(e.target.value)} disabled={c.stage === 'Closed Won'} className={input}>
                        {stageOptions(c.stage).map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
                    </select>
                    {c.stage !== 'Closed Won' && c.stage !== 'Closed Lost' && (
                        <p className="text-[11px] text-slate-400 mt-1">To mark Closed Won or Closed Lost, open the case.</p>
                    )}
                    {c.stage === 'Closed Lost' && stageMoved && (
                        <p className="text-[11px] text-slate-500 mt-1">This reopens the case.</p>
                    )}
                </div>
            )}

            {stage === 'Closed Lost' && (
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                    <input type="checkbox" checked={noFollowUp} onChange={e => setNoFollowUp(e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-red-600 shrink-0" />
                    <span className="text-sm text-slate-700">Don&apos;t follow up with this client again</span>
                </label>
            )}

            {!noFollowUp && (
                <>
                    <div>
                        <label className={label}>Next follow-up date *</label>
                        <input type="date" value={date} min={today} onChange={e => setDate(e.target.value)} className={input} style={{ maxWidth: 220 }} />
                        {carriedOverdue && date === today && (
                            <p className="text-[11px] text-amber-600 mt-1">
                                Was {new Date(`${current}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })} (overdue), so it&apos;s set to today. Change it if needed.
                            </p>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {quick.map(q => (
                                <button key={q.label} type="button" onClick={() => setDate(q.value)}
                                    className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${
                                        date === q.value ? 'bg-[#03a9e7] text-white border-[#03a9e7]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}>
                                    {q.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className={label}>Remark</label>
                        <textarea rows={2} value={remark} maxLength={500}
                            onChange={e => { setRemark(e.target.value); setRemarkEdited(true) }}
                            placeholder="e.g. Check with banker on approval"
                            className={input} style={{ fontFamily: 'inherit', resize: 'vertical' }} />
                    </div>
                </>
            )}

            {stage === 'Closed Won' && !noFollowUp && (
                <label className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 select-none ${reachable ? 'border-slate-200 cursor-pointer' : 'border-slate-100 bg-slate-50 cursor-not-allowed'}`}>
                    <input type="checkbox" checked={optIn && reachable} disabled={!reachable}
                        onChange={e => setOptIn(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#03a9e7] shrink-0" />
                    <span className="text-sm text-slate-700 leading-snug">
                        <span className="font-semibold flex items-center gap-1.5"><Mail size={13} className="text-[#03a9e7]" /> Client agreed to receive a reminder</span>
                        <span className="block text-xs text-slate-500 mt-0.5">
                            {reachable
                                ? 'TLC will WhatsApp and email your client once, on the follow-up date, to review their loan with you.'
                                : 'Add the client’s email or mobile to the case to turn this on.'}
                        </span>
                    </span>
                </label>
            )}

            {extra}

            {err && <p className="text-sm text-red-600">{err}</p>}

            <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={onCancel} disabled={saving}
                    className="px-4 py-2 text-sm font-semibold rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
                    <X size={14} /> Cancel
                </button>
                <button type="button" onClick={save} disabled={!canSave}
                    className="px-4 py-2 text-sm font-bold rounded-full bg-[#03a9e7] text-white disabled:opacity-40 flex items-center gap-1.5">
                    {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Check size={14} /> Save follow-up</>}
                </button>
            </div>
        </div>
    )
}
