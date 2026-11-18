'use client'

import { useRef, useState } from 'react'
import { Download, Upload, Loader2, CheckCircle2, FileSpreadsheet, Sparkles, History, ArrowRight } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import type { CaseIntake } from '@/lib/insurance/caseIntake'
import type { ReviewInput } from '@/lib/insurance/importReview'
import CaseImportReview from '@/components/insurance/cases/CaseImportReview'
import {
    FIELD_LABELS, MATCH_FIELDS, mappingProblems, layoutSignature,
    type ColumnGuess, type Mapping, type MatchField,
} from '@/lib/insurance/columnMatch'

/**
 * Mass Upload — upload the client list you ALREADY have (Excel or CSV, any
 * layout), confirm which column is which, review every row, import.
 *
 *   1. upload  → /import/read   opens the file, suggests column matches (rules, no AI)
 *   2. map     → agent confirms / fixes the matches; remembered per layout
 *   3. review  → /import        every row checked: ready / problem / already in HUB
 *   4. import  → /import/commit re-checks everything server-side and saves
 */

type Sheet = {
    fileName: string
    sheetName?: string
    headers: string[]
    rows: (string | number | null)[][]
    rowNumbers: number[]
}

type Step =
    | { kind: 'start' }
    | { kind: 'map'; sheet: Sheet; mapping: Mapping; source: ('header' | 'content' | 'saved' | null)[] }
    | { kind: 'preview'; sheet: Sheet; mapping: Mapping; rows: ReviewInput[]; banks: string[]; existing: [string, string | null][] }
    | { kind: 'done'; created: number; skipped: number; removed: number }

// Confirmed mappings, remembered per layout (column headings only — no client
// data) so the next upload from the same source maps itself.
const SAVED_KEY = 'hub:import-mapping:v1'
function loadSaved(sig: string): Mapping | null {
    try { return (JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, Mapping>)[sig] ?? null } catch { return null }
}
function saveMapping(sig: string, mapping: Mapping) {
    try {
        const all = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Record<string, Mapping>
        all[sig] = mapping
        localStorage.setItem(SAVED_KEY, JSON.stringify(all))
    } catch { /* storage blocked — just won't remember */ }
}

export default function CaseImportModal({ onClose }: { onClose: () => void }) {
    const [step, setStep] = useState<Step>({ kind: 'start' })
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    async function upload(file: File) {
        setBusy(true)
        setError(null)
        try {
            const body = new FormData()
            body.append('file', file)
            const res = await fetch('/api/insurance/cases/import/read', { method: 'POST', body })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) { setError(json.error ?? 'Could not read that file.'); return }
            const sheet: Sheet = json
            const guesses: ColumnGuess[] = json.guesses
            const saved = loadSaved(layoutSignature(sheet.headers))
            if (saved && saved.length === sheet.headers.length) {
                setStep({ kind: 'map', sheet, mapping: saved, source: saved.map(m => (m ? 'saved' : null)) })
            } else {
                setStep({ kind: 'map', sheet, mapping: guesses.map(g => g.field), source: guesses.map(g => g.via) })
            }
        } catch {
            setError('Network error — please try again.')
        } finally {
            setBusy(false)
            if (fileRef.current) fileRef.current.value = ''
        }
    }

    async function check(sheet: Sheet, mapping: Mapping) {
        setBusy(true)
        setError(null)
        try {
            const res = await fetch('/api/insurance/cases/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: sheet.rows, rowNumbers: sheet.rowNumbers, headers: sheet.headers, mapping }),
            })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) { setError(json.error ?? 'Could not check the rows.'); return }
            saveMapping(layoutSignature(sheet.headers), mapping)
            setStep({ kind: 'preview', sheet, mapping, rows: json.rows, banks: json.banks, existing: json.existing })
        } catch {
            setError('Network error — please try again.')
        } finally {
            setBusy(false)
        }
    }

    async function commit(rows: CaseIntake[], removed: number) {
        setBusy(true)
        setError(null)
        try {
            const res = await fetch('/api/insurance/cases/import/commit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows }),
            })
            const json = await res.json().catch(() => ({}))
            if (json.created > 0) invalidateCaseData()
            if (!res.ok) { setError(json.error ?? 'Import failed.'); return }
            setStep({ kind: 'done', created: json.created, skipped: json.skipped, removed })
        } catch {
            setError('Network error — please try again.')
        } finally {
            setBusy(false)
        }
    }

    const fileInput = (
        <input ref={fileRef} type="file" className="hidden"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
    )

    const title = step.kind === 'map' ? 'Mass Upload · Match columns' : step.kind === 'preview' ? 'Mass Upload · Review' : 'Mass Upload'

    return (
        <Modal title={title} onClose={onClose} size={step.kind === 'start' || step.kind === 'done' ? 'lg' : 'xl'}>
            {fileInput}

            {/* ── 1. Upload ── */}
            {step.kind === 'start' && (
                <div className="space-y-5">
                    <p className="text-sm text-slate-600">
                        Upload the client list you already have. <b>Any layout works</b>: HUB works out which column is which, and you confirm before anything is saved.
                    </p>
                    <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
                        className="w-full rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/40 hover:bg-sky-50 transition-colors px-6 py-8 flex flex-col items-center gap-2 disabled:opacity-60">
                        {busy ? <Loader2 size={26} className="animate-spin text-[#03a9e7]" /> : <Upload size={26} className="text-[#03a9e7]" />}
                        <span className="text-sm font-bold text-[#052d4a]">{busy ? 'Reading your file…' : 'Choose your client list'}</span>
                        <span className="text-xs text-slate-500">Excel (.xlsx) or CSV · up to 2,000 clients</span>
                    </button>
                    <div className="grid sm:grid-cols-3 gap-2 text-[11px] text-slate-500">
                        <Tip title="Excel / Numbers">Upload the file as it is.</Tip>
                        <Tip title="Google Sheets">File → Download → Microsoft Excel.</Tip>
                        <Tip title="CRM">Use its Export button (CSV).</Tip>
                    </div>
                    <p className="text-xs text-slate-500">
                        Only <b>name</b> and <b>mobile</b> are needed. Clients come in as <b>Inactive</b> (past clients, follow-up only) unless your file says otherwise.
                        Anyone already in your HUB (same mobile) is skipped.
                    </p>
                    <p className="text-xs text-slate-400">
                        No list yet?{' '}
                        <a href="/api/insurance/cases/import/template" download className="font-semibold text-[#03a9e7] hover:underline inline-flex items-center gap-1">
                            <Download size={12} /> Download a blank sheet
                        </a>
                    </p>
                    {error && <ErrorBox msg={error} />}
                </div>
            )}

            {/* ── 2. Match columns ── */}
            {step.kind === 'map' && (() => {
                const { sheet, mapping, source } = step
                const problems = mappingProblems(mapping)
                const setField = (col: number, field: MatchField | null) => {
                    const next = mapping.map((m, i) => {
                        if (i === col) return field
                        // a field can feed only one column — except "Add to remarks", which collects several
                        return field && field !== 'extra_remarks' && m === field ? null : m
                    })
                    setStep({ ...step, mapping: next, source: source.map((s, i) => (i === col ? null : next[i] ? s : null)) })
                }
                const savedLayout = source.some(s => s === 'saved')
                // Columns that hold data but are set to "Don't import" — surfaced so
                // nothing the agent recorded is dropped without them choosing to.
                const unmappedWithData = sheet.headers
                    .map((h, col) => ({ h, col }))
                    .filter(({ col }) => !mapping[col] && sheet.rows.some(r => r[col] != null && String(r[col]).trim() !== ''))
                const addAllToRemarks = () => setStep({
                    ...step,
                    mapping: mapping.map((m, col) => (unmappedWithData.some(u => u.col === col) ? 'extra_remarks' : m)),
                    source: source.map((s, col) => (unmappedWithData.some(u => u.col === col) ? null : s)),
                })
                return (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1.5"><FileSpreadsheet size={14} className="text-emerald-600" /> {sheet.fileName}{sheet.sheetName ? ` · ${sheet.sheetName}` : ''}</span>
                            <span>{sheet.rows.length} client{sheet.rows.length === 1 ? '' : 's'} found</span>
                        </div>
                        <p className="text-sm text-slate-600">
                            {savedLayout
                                ? 'Same layout as your last upload, so your column choices were reused. Check and continue.'
                                : 'HUB matched your columns below. Fix any that are wrong, and set columns you don\'t need to "Don\'t import".'}
                        </p>

                        <div className="rounded-xl border border-slate-200 overflow-auto max-h-[50vh]">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-slate-50 z-10">
                                    <tr className="border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        <th className="px-3 py-2 text-left">Your column</th>
                                        <th className="px-3 py-2 text-left">Sample from your file</th>
                                        <th className="px-3 py-2 text-left w-64">Goes into HUB as</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sheet.headers.map((h, col) => {
                                        const samples = sheet.rows.map(r => r[col]).filter(v => v != null && String(v).trim() !== '').slice(0, 3)
                                        const field = mapping[col]
                                        return (
                                            <tr key={col} className={`border-b border-slate-50 align-top ${field ? '' : 'opacity-60'}`}>
                                                <td className="px-3 py-2.5 font-semibold text-slate-700">{h}</td>
                                                <td className="px-3 py-2.5 text-xs text-slate-500">
                                                    {samples.length ? samples.map((s, i) => <div key={i} className="truncate max-w-[260px]">{String(s)}</div>) : <span className="text-slate-300">(empty)</span>}
                                                </td>
                                                <td className="px-3 py-2.5">
                                                    <select value={field ?? ''} onChange={e => setField(col, (e.target.value || null) as MatchField | null)}
                                                        className={`w-full px-2.5 py-2 text-sm rounded-lg border outline-none bg-white ${field ? 'border-sky-200 text-[#052d4a] font-semibold' : 'border-slate-200 text-slate-400'}`}>
                                                        <option value="">Don&apos;t import</option>
                                                        {MATCH_FIELDS.map(f => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                                                    </select>
                                                    {field && source[col] && (
                                                        <p className="text-[10px] text-slate-400 mt-1 inline-flex items-center gap-1">
                                                            {source[col] === 'saved' ? <><History size={10} /> from your last upload</>
                                                                : source[col] === 'header' ? <><Sparkles size={10} /> matched by column name</>
                                                                    : <><Sparkles size={10} /> matched by what&apos;s in it — please check</>}
                                                        </p>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {unmappedWithData.length > 0 && (
                            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                                <span>
                                    {unmappedWithData.length} column{unmappedWithData.length > 1 ? 's' : ''} with data won&apos;t be imported:{' '}
                                    <b>{unmappedWithData.map(u => u.h).join(', ')}</b>. Pick a HUB field above, or keep them as notes.
                                </span>
                                <button type="button" onClick={addAllToRemarks} className="font-bold text-[#03a9e7] hover:underline shrink-0">
                                    Add them all to remarks
                                </button>
                            </div>
                        )}

                        {problems.length > 0 && (
                            <ul className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
                                {problems.map(p => <li key={p}>• {p}</li>)}
                            </ul>
                        )}
                        {error && <ErrorBox msg={error} />}

                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
                                className="text-sm font-semibold text-slate-500 hover:text-slate-700 inline-flex items-center gap-1.5">
                                <Upload size={14} /> Choose a different file
                            </button>
                            <button type="button" disabled={busy || problems.length > 0} onClick={() => check(sheet, mapping)}
                                className="btn-primary text-sm px-5 py-2 inline-flex items-center gap-2 disabled:opacity-40">
                                {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                                Check {sheet.rows.length} row{sheet.rows.length === 1 ? '' : 's'}
                            </button>
                        </div>
                    </div>
                )
            })()}

            {/* ── 3. Review + fix in place ── */}
            {step.kind === 'preview' && (
                <CaseImportReview
                    // a fresh check (e.g. after changing column matches) starts a fresh review
                    key={JSON.stringify(step.mapping)}
                    initialRows={step.rows}
                    banks={step.banks}
                    existing={step.existing}
                    busy={busy}
                    error={error}
                    onBack={() => { setError(null); setStep({ kind: 'map', sheet: step.sheet, mapping: step.mapping, source: step.mapping.map(m => (m ? 'saved' : null)) }) }}
                    onImport={commit}
                />
            )}

            {/* ── 4. Done ── */}
            {step.kind === 'done' && (
                <div className="text-center space-y-3 py-4">
                    <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
                    <p className="text-lg font-bold text-[#052d4a]">{step.created} client{step.created === 1 ? '' : 's'} added</p>
                    {(step.skipped > 0 || step.removed > 0) && (
                        <p className="text-xs text-slate-500">
                            {[step.skipped > 0 && `${step.skipped} already in HUB (skipped)`, step.removed > 0 && `${step.removed} removed by you`].filter(Boolean).join(' · ')}
                        </p>
                    )}
                    <button type="button" onClick={onClose} className="btn-primary text-sm px-5 py-2">Done</button>
                </div>
            )}
        </Modal>
    )
}

function Tip({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
            <p className="font-semibold text-slate-600">{title}</p>
            <p>{children}</p>
        </div>
    )
}

function ErrorBox({ msg }: { msg: string }) {
    return <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{msg}</p>
}
