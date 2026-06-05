'use client'

import { useMemo, useState } from 'react'
import { X, Sparkles, Pencil, Trash2, Plus, ChevronDown, AlertTriangle, ArrowLeft, Check } from 'lucide-react'
import { MortgagePackage, MortgagePackageInput, RateCategory } from '@/lib/types/rates'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import RatePackageEditorModal from './RatePackageEditorModal'
import Spinner from '@/components/shared/Spinner'

interface Props {
    onClose: () => void
    onDone: () => void                    // reload after a successful replace
}

const fmtLoan = (n: number) => `$${n.toLocaleString()}`

export default function RateIngestionModal({ onClose, onDone }: Props) {
    const [step, setStep] = useState<'input' | 'review'>('input')
    const [bank, setBank] = useState('')
    const [text, setText] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [rows, setRows] = useState<MortgagePackageInput[]>([])
    const [existingForBank, setExistingForBank] = useState<MortgagePackage[]>([])
    const [publish, setPublish] = useState(true)
    const [showSource, setShowSource] = useState(false)
    const [editIndex, setEditIndex] = useState<number | null>(null)
    const [addingNew, setAddingNew] = useState(false)

    // Scope = the distinct categories present in the reviewed rows (kept in sync).
    const scopeCategories = useMemo(() => [...new Set(rows.map(r => r.category))], [rows])

    // Per-category diff: how many existing rows get removed vs how many new added.
    // Uses the authoritative current set for this bank (fetched fresh, not the
    // page's filtered list) so the "remove" count never understates the deletion.
    const diff = useMemo(() => scopeCategories.map(cat => ({
        category: cat,
        remove: existingForBank.filter(p => p.category === cat).length,
        add: rows.filter(r => r.category === cat).length,
    })), [existingForBank, scopeCategories, rows])

    const extract = async () => {
        setBusy(true); setError(null)
        try {
            // Extract + fetch the bank's authoritative current set in parallel.
            const [exRes, curRes] = await Promise.all([
                fetch('/api/admin/rates/extract', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bank, text }),
                }),
                fetch(`/api/insurance/rates?bank=${encodeURIComponent(bank)}`),
            ])
            const json = await exRes.json()
            if (!exRes.ok) throw new Error(json.error || 'Extraction failed')
            if (!json.packages?.length) throw new Error('No packages found in that text.')
            const cur = curRes.ok ? (await curRes.json()).data ?? [] : []
            setExistingForBank(cur)
            setRows(json.packages)
            setStep('review')
        } catch (e: any) {
            setError(e.message)
        } finally {
            setBusy(false)
        }
    }

    const replace = async () => {
        setBusy(true); setError(null)
        try {
            const res = await fetch('/api/admin/rates/replace', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bank, categories: scopeCategories,
                    packages: rows.map(r => ({ ...r, status: publish ? 'published' : 'draft' })),
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Replace failed')
            onDone()
        } catch (e: any) {
            setError(e.message)
            setBusy(false)
        }
    }

    const totalRemove = diff.reduce((s, d) => s + d.remove, 0)

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#03a9e7]/15"><Sparkles size={15} className="text-[#03a9e7]" /></span>
                        <h3 className="text-lg font-bold text-[#052d4a]">Import rates from sheet</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                {error && (
                    <div className="mx-6 mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-1.5">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
                    </div>
                )}

                {/* ── Step 1: input ── */}
                {step === 'input' && (
                    <>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Bank *</label>
                                <InsuranceBankDropdown value={bank} onChange={setBank} />
                                <p className="text-[11px] text-slate-400 mt-1">You pick the bank — the importer only ever replaces this bank&apos;s packages.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Paste the rate block from your sheet *</label>
                                <textarea value={text} onChange={e => setText(e.target.value)} rows={12}
                                    placeholder={'Paste a bank’s package block here, e.g.\n\n*HSBC - 2 Years Fixed - 2 Years Lock-in*\nYear 1: 1.50% Fixed\nYear 2: 1.50% Fixed\nThereafter: 1M SORA + 1.00%\n\nPackage Features\n- 1 free conversion after 12 months'}
                                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 resize-y font-mono" />
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0 bg-slate-50/50">
                            <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                            <button onClick={extract} disabled={!bank.trim() || !text.trim() || busy} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                                {busy ? <Spinner size="sm" color="white" label="Extracting…" /> : <><Sparkles size={15} /> Extract packages</>}
                            </button>
                        </div>
                    </>
                )}

                {/* ── Step 2: review ── */}
                {step === 'review' && (
                    <>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            {/* Diff / scope summary */}
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                                    <AlertTriangle size={15} /> Confirm what will be replaced for <span className="underline">{bank}</span>
                                </p>
                                <ul className="mt-2 space-y-1 text-[13px] text-amber-900">
                                    {diff.map(d => (
                                        <li key={d.category}>
                                            <span className="font-semibold">{d.category}</span>: remove {d.remove} existing → add {d.add} new
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-[11px] text-amber-700 mt-2">
                                    Only these categories are touched. {bank}&apos;s other categories are left untouched. {totalRemove > 0 ? `${totalRemove} current package${totalRemove !== 1 ? 's' : ''} will be deleted.` : 'No existing packages will be deleted.'}
                                </p>
                            </div>

                            {/* Extracted rows */}
                            <div className="space-y-2.5">
                                {rows.map((r, i) => (
                                    <ReviewRow key={i} row={r} onEdit={() => setEditIndex(i)} onRemove={() => setRows(rows.filter((_, idx) => idx !== i))} />
                                ))}
                            </div>

                            <button onClick={() => setAddingNew(true)}
                                className="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] flex items-center gap-1">
                                <Plus size={13} /> Add a package
                            </button>

                            {/* Source text for cross-check */}
                            <div>
                                <button onClick={() => setShowSource(!showSource)} className="text-xs font-medium text-slate-500 hover:text-[#03a9e7] flex items-center gap-1">
                                    <ChevronDown size={13} className={showSource ? 'rotate-180' : ''} /> {showSource ? 'Hide' : 'Show'} original pasted text
                                </button>
                                {showSource && (
                                    <pre className="mt-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">{text}</pre>
                                )}
                            </div>
                        </div>

                        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-between items-center shrink-0 bg-slate-50/50 flex-wrap">
                            <button onClick={() => { setStep('input'); setError(null) }} className="btn-ghost px-3 py-2 text-sm flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
                            <div className="flex gap-3 items-center">
                                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                                    <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} className="accent-[#03a9e7]" />
                                    Publish to agents now
                                </label>
                                <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                                <button onClick={replace} disabled={busy || rows.length === 0} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                                    {busy ? <Spinner size="sm" color="white" label="Replacing…" /> : <><Check size={15} /> Confirm &amp; replace</>}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Per-row edit / add (reuses the standard editor) */}
            {editIndex !== null && (
                <RatePackageEditorModal
                    initial={{ ...rows[editIndex], id: '', first_year_rate: null, last_updated: '' } as MortgagePackage}
                    saving={false}
                    onSave={async (input) => { setRows(rows.map((r, idx) => idx === editIndex ? input : r)); setEditIndex(null) }}
                    onClose={() => setEditIndex(null)}
                />
            )}
            {addingNew && (
                <RatePackageEditorModal
                    initial={null}
                    defaultBank={bank}
                    saving={false}
                    onSave={async (input) => { setRows([...rows, input]); setAddingNew(false) }}
                    onClose={() => setAddingNew(false)}
                />
            )}
        </div>
    )
}

function ReviewRow({ row, onEdit, onRemove }: { row: MortgagePackageInput; onEdit: () => void; onRemove: () => void }) {
    const lines = formatRateSchedule(row.rate_schedule)
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${row.category === 'Fixed' ? 'bg-[#052d4a] text-white' : row.category === 'Floating (Completed)' ? 'bg-[#03a9e7] text-white' : 'bg-amber-500 text-white'}`}>{row.category}</span>
                        <span className="text-[11px] text-slate-400">{row.property_type}</span>
                        <span className="text-[11px] text-slate-400">{row.lockin_years === 0 ? 'No lock-in' : `${row.lockin_years}Y lock-in`}</span>
                        <span className="text-[11px] text-slate-400">{fmtLoan(row.min_loan_size)}{row.min_loan_note ? ` · ${row.min_loan_note}` : ''}</span>
                    </div>
                    <p className="text-[13px] font-medium text-slate-700 mt-1">{row.package_name}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button onClick={onEdit} title="Edit" className="p-1.5 text-slate-400 hover:text-[#03a9e7] hover:bg-slate-100 rounded-lg"><Pencil size={14} /></button>
                    <button onClick={onRemove} title="Remove" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                </div>
            </div>
            <div className="mt-2 rounded-lg bg-slate-50 border border-slate-100 p-2 space-y-0.5">
                {lines.map((l, i) => <p key={i} className="text-[12px] text-slate-600 tabular-nums">{l}</p>)}
            </div>
            {row.features && row.features.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                    {row.features.map((f, i) => <li key={i} className="text-[11px] text-slate-400 flex gap-1"><span className="text-[#03a9e7]">›</span>{f}</li>)}
                </ul>
            )}
        </div>
    )
}
