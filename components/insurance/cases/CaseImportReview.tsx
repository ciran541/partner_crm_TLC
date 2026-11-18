'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, AlertCircle, CopyX, Loader2, Pencil, Trash2, Undo2, ChevronUp, Wand2 } from 'lucide-react'
import { INTAKE_CASE_TYPES, INTAKE_PROPERTY_TYPES, type CaseIntake } from '@/lib/insurance/caseIntake'
import { CREATABLE_STAGES } from '@/lib/insurance/stages'
import { FIELD_LABELS } from '@/lib/insurance/columnMatch'
import { reviewRows, rowsWithSameValue, type ReviewInput, type ReviewStatus } from '@/lib/insurance/importReview'

/**
 * Mass upload — review + fix in place.
 *
 * Every row is checked live (same rules as the server) as the agent edits:
 * the wrong field is highlighted with the reason, and the row turns green the
 * moment it's valid. Import stays locked until every problem is fixed or the
 * agent explicitly removes the row — problems are never silently skipped.
 * A fix can be applied to every other row holding the same bad value.
 */

type Field = keyof CaseIntake

const CORE: Field[] = ['client_name', 'client_mobile', 'client_email']

/** Editable fields in display order (= every HUB field the import can fill). */
const EDIT_FIELDS: Field[] = [
    'client_name', 'client_mobile', 'client_email', 'case_type', 'stage', 'loan_amount', 'current_bank',
    'lock_in_end_date', 'follow_up_date', 'property_type', 'property_address', 'remaining_tenure', 'current_rate',
    'property_value', 'year_of_purchase', 'subsidy', 'clawback_end_date', 'outstanding_equity_loan',
    'equity_loan_tenure', 'property_use', 'borrower_age', 'borrower_income', 'borrower_variable',
    'borrower_commitments', 'borrower_residency', 'remarks',
]

const SELECTS: Partial<Record<Field, { value: string; label: string }[]>> = {
    case_type: INTAKE_CASE_TYPES.map(t => ({ value: t.label, label: t.label })),
    stage: CREATABLE_STAGES.map(s => ({ value: s, label: s })),
    property_type: INTAKE_PROPERTY_TYPES.map(p => ({ value: p, label: p })),
    property_use: [{ value: 'Own stay', label: 'Own stay' }, { value: 'Investment', label: 'Investment' }],
    borrower_residency: [{ value: 'Singaporean', label: 'Singaporean' }, { value: 'PR', label: 'PR' }, { value: 'Foreigner', label: 'Foreigner' }],
}

const PLACEHOLDER: Partial<Record<Field, string>> = {
    client_mobile: '91234567', client_email: 'name@email.com', loan_amount: '750,000',
    lock_in_end_date: 'DD/MM/YYYY', follow_up_date: 'DD/MM/YYYY', clawback_end_date: 'DD/MM/YYYY',
    current_rate: '2.6', borrower_age: 'age or DD/MM/YYYY',
}

const typeLabel = (t: string) => INTAKE_CASE_TYPES.find(x => x.value === t)?.label ?? t
const money = (n?: number) => (n != null ? `$${Math.round(n).toLocaleString('en-SG')}` : '—')

type Filter = 'all' | ReviewStatus

export default function CaseImportReview({ initialRows, banks, existing, busy, error, onBack, onImport }: {
    initialRows: ReviewInput[]
    banks: string[]
    existing: [string, string | null][]
    busy: boolean
    error: string | null
    onBack: () => void
    onImport: (ready: CaseIntake[], removed: number) => void
}) {
    const [rows, setRows] = useState<ReviewInput[]>(initialRows)
    const existingMap = useMemo(() => new Map(existing), [existing])
    const review = useMemo(() => reviewRows(rows, banks, existingMap), [rows, banks, existingMap])
    const { counts } = review

    const [filter, setFilter] = useState<Filter>(() => (reviewRows(initialRows, banks, new Map(existing)).counts.error > 0 ? 'error' : 'all'))
    const [open, setOpen] = useState<Set<number>>(new Set())          // rows the agent opened to edit
    const [showAll, setShowAll] = useState<Set<number>>(new Set())    // rows showing every field
    // Value a field held when the agent started fixing it — powers "apply to all rows with this value".
    const [original, setOriginal] = useState<Record<string, string>>({})

    const setField = (i: number, field: Field, value: string) => {
        const k = `${i}:${field}`
        if (!(k in original) && review.rows[i].fieldErrors?.[field]) {
            setOriginal(o => ({ ...o, [k]: rows[i].raw[field] ?? '' }))
        }
        setRows(rs => rs.map((r, j) => (j === i ? { ...r, raw: { ...r.raw, [field]: value } } : r)))
    }
    const applyToSame = (i: number, field: Field, from: string) => {
        const targets = rowsWithSameValue(rows, field, from, i)
        const to = rows[i].raw[field] ?? ''
        setRows(rs => rs.map((r, j) => (targets.includes(j) ? { ...r, raw: { ...r.raw, [field]: to } } : r)))
        setOriginal(o => { const n = { ...o }; delete n[`${i}:${field}`]; return n })
    }
    const setRemoved = (i: number, removed: boolean) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, removed } : r)))
    const removeAllProblems = () => {
        if (!window.confirm(`Remove all ${counts.error} rows that still have problems? They won't be imported.`)) return
        const errorIdx = new Set(review.rows.flatMap((r, i) => (r.status === 'error' ? [i] : [])))
        setRows(rs => rs.map((r, i) => (errorIdx.has(i) ? { ...r, removed: true } : r)))
    }
    const toggle = (set: Set<number>, i: number, update: (s: Set<number>) => void) => {
        const n = new Set(set)
        if (n.has(i)) n.delete(i); else n.add(i)
        update(n)
    }

    const visible = review.rows.map((r, i) => ({ r, i })).filter(({ r }) => filter === 'all' || r.status === filter)

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
                <Chip active={filter === 'all'} onClick={() => setFilter('all')} label={`All ${rows.length}`} />
                <Chip active={filter === 'ok'} onClick={() => setFilter('ok')} tone="ok" label={`Ready ${counts.ok}`} />
                <Chip active={filter === 'error'} onClick={() => setFilter('error')} tone="error" label={`Needs fixing ${counts.error}`} />
                <Chip active={filter === 'duplicate'} onClick={() => setFilter('duplicate')} tone="dup" label={`Already in HUB ${counts.duplicate}`} />
                {counts.removed > 0 && <Chip active={filter === 'removed'} onClick={() => setFilter('removed')} tone="dup" label={`Removed ${counts.removed}`} />}
            </div>

            <div className="rounded-xl border border-slate-200 overflow-auto max-h-[52vh]">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 z-10">
                        <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="px-3 py-2 text-left w-14">Row</th>
                            <th className="px-3 py-2 text-left">Client</th>
                            <th className="px-3 py-2 text-left">Type · Stage</th>
                            <th className="px-3 py-2 text-right">Loan</th>
                            <th className="px-3 py-2 text-left">Bank</th>
                            <th className="px-3 py-2 text-left">Lock-in</th>
                            <th className="px-3 py-2 text-left">Status</th>
                            <th className="px-3 py-2 w-24" />
                        </tr>
                    </thead>
                    <tbody>
                        {visible.map(({ r, i }) => {
                            const raw = rows[i].raw
                            const isOpen = r.status === 'error' || open.has(i)
                            const v = r.value
                            const errs = r.fieldErrors ?? {}
                            const fields = showAll.has(i)
                                ? EDIT_FIELDS
                                : EDIT_FIELDS.filter(f => CORE.includes(f) || (raw[f] ?? '') !== '' || errs[f])
                            return [
                                <tr key={`r${i}`} className={`border-b border-slate-50 align-top ${r.status === 'removed' ? 'opacity-50' : ''} ${isOpen ? 'bg-slate-50/60' : ''}`}>
                                    <td className="px-3 py-2 text-slate-400 tabular-nums">{r.rowNumber}</td>
                                    <td className="px-3 py-2">
                                        <p className={`font-semibold text-slate-700 ${r.status === 'removed' ? 'line-through' : ''}`}>{v?.client_name ?? (raw.client_name || <span className="text-slate-300">(no name)</span>)}</p>
                                        <p className="text-[11px] text-slate-400">{v?.client_mobile ?? raw.client_mobile ?? ''}</p>
                                    </td>
                                    <td className="px-3 py-2 text-xs text-slate-600">{v ? `${typeLabel(v.case_type)} · ${v.stage}` : '—'}</td>
                                    <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-600">{v ? money(v.loan_amount) : '—'}</td>
                                    <td className="px-3 py-2 text-xs text-slate-600">{v?.current_bank ?? '—'}</td>
                                    <td className="px-3 py-2 text-xs text-slate-600 tabular-nums">{v?.lock_in_end_date ?? '—'}</td>
                                    <td className="px-3 py-2">
                                        {r.status === 'ok' && <Status tone="ok" text="Ready" />}
                                        {r.status === 'error' && <Status tone="error" text={`Fix ${Object.keys(errs).length} field${Object.keys(errs).length > 1 ? 's' : ''}`} />}
                                        {r.status === 'duplicate' && <Status tone="dup" text={r.reason ?? 'Skipped'} />}
                                        {r.status === 'removed' && <Status tone="dup" text="Removed by you" />}
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        {r.status === 'removed' ? (
                                            <IconBtn title="Restore row" onClick={() => setRemoved(i, false)}><Undo2 size={14} /></IconBtn>
                                        ) : (
                                            <>
                                                {r.status !== 'error' && (
                                                    <IconBtn title={isOpen ? 'Close' : 'Edit'} onClick={() => toggle(open, i, setOpen)}>
                                                        {isOpen ? <ChevronUp size={14} /> : <Pencil size={14} />}
                                                    </IconBtn>
                                                )}
                                                <IconBtn title="Remove row (won't be imported)" onClick={() => setRemoved(i, true)} danger><Trash2 size={14} /></IconBtn>
                                            </>
                                        )}
                                    </td>
                                </tr>,
                                isOpen && r.status !== 'removed' && (
                                    <tr key={`e${i}`} className="border-b border-slate-100 bg-slate-50/60">
                                        <td />
                                        <td colSpan={7} className="px-3 pb-4 pt-1">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-2.5">
                                                {fields.map(f => {
                                                    const err = errs[f]
                                                    const from = original[`${i}:${f}`]
                                                    const same = from != null && !err ? rowsWithSameValue(rows, f, from, i) : []
                                                    return (
                                                        <div key={f} className={f === 'remarks' || f === 'property_address' ? 'sm:col-span-2' : ''}>
                                                            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${err ? 'text-red-600' : 'text-slate-400'}`}>
                                                                {FIELD_LABELS[f]}{(f === 'client_name' || f === 'client_mobile') && <span className="text-red-400"> *</span>}
                                                            </label>
                                                            <FieldInput field={f} value={raw[f] ?? ''} invalid={!!err} onChange={val => setField(i, f, val)} />
                                                            {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
                                                            {same.length > 0 && (
                                                                <button type="button" onClick={() => applyToSame(i, f, from!)}
                                                                    className="mt-1 text-[11px] font-semibold text-[#03a9e7] hover:underline inline-flex items-center gap-1">
                                                                    <Wand2 size={11} /> Apply to {same.length} other row{same.length > 1 ? 's' : ''} with &ldquo;{from}&rdquo;
                                                                </button>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                            <button type="button" onClick={() => toggle(showAll, i, setShowAll)}
                                                className="mt-3 text-[11px] font-semibold text-slate-500 hover:text-slate-700">
                                                {showAll.has(i) ? 'Show fewer fields' : 'Show all fields'}
                                            </button>
                                        </td>
                                    </tr>
                                ),
                            ]
                        })}
                        {visible.length === 0 && (
                            <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-400">
                                {filter === 'error' ? 'All problems fixed 🎉' : 'Nothing in this list.'}
                            </td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {counts.error > 0 ? (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <span>
                        {counts.error === 1 ? '1 row needs fixing' : `${counts.error} rows need fixing`}  before you can import.
                        Correct the highlighted fields above, or remove a row you don&apos;t want.
                        If a whole column is wrong, go back and change its match.
                    </span>
                    <button type="button" onClick={removeAllProblems} className="font-semibold text-amber-900 hover:underline shrink-0">
                        Remove all {counts.error} instead
                    </button>
                </div>
            ) : counts.ok > 0 ? (
                <p className="text-xs text-emerald-700">
                    All set: {counts.ok} client{counts.ok === 1 ? '' : 's'} ready
                    {counts.duplicate > 0 && `, ${counts.duplicate} already in HUB will be skipped`}
                    {counts.removed > 0 && `, ${counts.removed} removed by you`}.
                </p>
            ) : null}
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" disabled={busy} className="text-sm font-semibold text-slate-500 hover:text-slate-700"
                    onClick={() => {
                        // Changing a column match re-reads every row, so fixes made here can't carry over — say so.
                        if (rows !== initialRows && !window.confirm('Going back will undo the fixes and removals you made on this screen. Continue?')) return
                        onBack()
                    }}>
                    ← Back to column matching
                </button>
                <button type="button" disabled={busy || !review.canImport} onClick={() => onImport(review.ready, counts.removed)}
                    className="btn-primary text-sm px-5 py-2 inline-flex items-center gap-2 disabled:opacity-40">
                    {busy && <Loader2 size={14} className="animate-spin" />}
                    {counts.error > 0
                        ? `Fix ${counts.error} problem${counts.error > 1 ? 's' : ''} to continue`
                        : counts.ok === 0 ? 'Nothing new to import'
                            : `Import ${counts.ok} client${counts.ok === 1 ? '' : 's'}`}
                </button>
            </div>
        </div>
    )
}

function FieldInput({ field, value, invalid, onChange }: { field: Field; value: string; invalid: boolean; onChange: (v: string) => void }) {
    const cls = `w-full px-2.5 py-2 text-sm rounded-lg border bg-white outline-none transition-colors ${invalid ? 'border-red-300 ring-2 ring-red-100 focus:border-red-400' : 'border-slate-200 focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/10'
        }`
    const options = SELECTS[field]
    if (options) {
        const known = options.some(o => o.value.toLowerCase() === value.toLowerCase())
        return (
            <select className={cls} value={known ? options.find(o => o.value.toLowerCase() === value.toLowerCase())!.value : value} onChange={e => onChange(e.target.value)}>
                <option value="">—</option>
                {!known && value && <option value={value}>{value} (not recognised)</option>}
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
        )
    }
    if (field === 'remarks') {
        return <textarea className={`${cls} min-h-[56px]`} value={value} onChange={e => onChange(e.target.value)} />
    }
    return <input className={cls} value={value} placeholder={PLACEHOLDER[field]} onChange={e => onChange(e.target.value)}
        inputMode={field === 'client_mobile' ? 'tel' : field === 'client_email' ? 'email' : undefined} />
}

const TONE = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    error: 'bg-red-50 text-red-700 border-red-200',
    dup: 'bg-slate-100 text-slate-500 border-slate-200',
} as const

function Chip({ active, onClick, label, tone }: { active: boolean; onClick: () => void; label: string; tone?: keyof typeof TONE }) {
    return (
        <button type="button" onClick={onClick}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${active ? 'bg-[#052d4a] text-white border-[#052d4a]' : tone ? TONE[tone] : 'bg-white text-slate-500 border-slate-200'
                }`}>
            {label}
        </button>
    )
}

function Status({ tone, text }: { tone: keyof typeof TONE; text: string }) {
    const Icon = tone === 'ok' ? CheckCircle2 : tone === 'error' ? AlertCircle : CopyX
    return (
        <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE[tone]}`}>
            <Icon size={11} /> {text}
        </span>
    )
}

function IconBtn({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
    return (
        <button type="button" title={title} aria-label={title} onClick={onClick}
            className={`p-1.5 rounded-lg transition-colors ${danger ? 'text-slate-300 hover:text-red-500 hover:bg-red-50' : 'text-slate-400 hover:text-[#03a9e7] hover:bg-sky-50'}`}>
            {children}
        </button>
    )
}
