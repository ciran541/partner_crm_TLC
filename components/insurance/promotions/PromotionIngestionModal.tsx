'use client'

import { useState } from 'react'
import { X, Sparkles, Pencil, Trash2, ChevronDown, AlertTriangle, ArrowLeft, Check, Gift, Users } from 'lucide-react'
import type { BankPromotionInput } from '@/lib/types/promotions'
import { WINDOW_BASIS_LABELS } from '@/lib/types/promotions'
import PromotionEditorModal from './PromotionEditorModal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import Spinner from '@/components/shared/Spinner'

interface Props {
    onClose: () => void
    onDone: () => void
}

const money = (n: number) => `$${n.toLocaleString()}`
const shortLoan = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}m` : `$${Math.round(n / 1000)}k`

const EXAMPLE = `Dear Partners, SCB National Day Promotion Cash Rebate For Client (3 to 16 August) & Extension Of 0.2% Referral

Loan Size $1m to $1.5m
Cash Rebate $800

Loan size above $1.5m
Cash Rebate $1200

Conditions:
*Only applicable for loan submit 3 Aug or after to 16 Aug
...`

/**
 * Paste a bank's promo blast → DeepSeek structures it → admin reviews → save.
 *
 * The review step is the point of the whole screen, not a formality: the model
 * decides which benefit belongs to the CLIENT and which belongs to the AGENT,
 * and that call is the one thing here that must not be wrong. Each row shows
 * its audience prominently and is editable before anything is written.
 */
export default function PromotionIngestionModal({ onClose, onDone }: Props) {
    const [step, setStep] = useState<'input' | 'review'>('input')
    const [bank, setBank] = useState('')
    const [text, setText] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [rows, setRows] = useState<BankPromotionInput[]>([])
    const [publish, setPublish] = useState(true)
    const [showSource, setShowSource] = useState(false)
    const [editIndex, setEditIndex] = useState<number | null>(null)

    const extract = async () => {
        setBusy(true); setError(null)
        try {
            const res = await fetch('/api/admin/insurance/promotions/extract', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bank, text }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Extraction failed')
            if (!json.promotions?.length) throw new Error('No promotions found in that message.')
            setRows(json.promotions.map((p: BankPromotionInput) => ({ ...p, source_text: text, notes: null, status: 'draft' })))
            setStep('review')
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Extraction failed')
        } finally {
            setBusy(false)
        }
    }

    const save = async () => {
        setBusy(true); setError(null)
        try {
            const res = await fetch('/api/admin/insurance/promotions', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inputs: rows.map(r => ({ ...r, status: publish ? 'published' : 'draft' })),
                }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || 'Save failed')
            onDone()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed')
            setBusy(false)
        }
    }

    const clientRows = rows.filter(r => r.audience !== 'agent').length
    const agentRows = rows.length - clientRows

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-amber-100"><Sparkles size={15} className="text-amber-600" /></span>
                        <h3 className="text-lg font-bold text-[#052d4a]">Import promotion from a bank message</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                {error && (
                    <div className="mx-6 mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-1.5">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
                    </div>
                )}

                {/* ── Step 1: paste ── */}
                {step === 'input' && (
                    <>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Bank *</label>
                                <InsuranceBankDropdown value={bank} onChange={setBank} />
                                <p className="text-[11px] text-slate-400 mt-1">You pick the bank — the extractor never decides which bank a promotion belongs to.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Paste the bank&apos;s message *</label>
                                <textarea value={text} onChange={e => setText(e.target.value)} rows={12} placeholder={EXAMPLE}
                                    className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 resize-y font-mono" />
                                <p className="text-[11px] text-slate-400 mt-1">
                                    Paste it whole, including the conditions. If the message covers a client rebate <em>and</em> an agent referral, both are picked up as separate promotions.
                                </p>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0 bg-slate-50/50">
                            <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                            <button onClick={extract} disabled={!bank.trim() || !text.trim() || busy} className="btn-primary px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
                                {busy ? <Spinner size="sm" color="white" label="Reading…" /> : <><Sparkles size={15} /> Extract promotions</>}
                            </button>
                        </div>
                    </>
                )}

                {/* ── Step 2: review ── */}
                {step === 'review' && (
                    <>
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                                    <AlertTriangle size={15} /> Check the audience on each row before saving
                                </p>
                                <p className="text-[12px] text-amber-900 mt-1">
                                    Found <strong>{rows.length}</strong> promotion{rows.length === 1 ? '' : 's'} for {bank}
                                    {agentRows > 0 && <> — {clientRows} client-facing, {agentRows} agent-only</>}.
                                    Anything marked <strong>agent-only</strong> stays internal and never appears in a client document.
                                </p>
                            </div>

                            <div className="space-y-2.5">
                                {rows.map((r, i) => (
                                    <ReviewRow key={i} row={r}
                                        onEdit={() => setEditIndex(i)}
                                        onRemove={() => setRows(rows.filter((_, idx) => idx !== i))} />
                                ))}
                            </div>

                            <div>
                                <button onClick={() => setShowSource(!showSource)} className="text-xs font-medium text-slate-500 hover:text-[#03a9e7] flex items-center gap-1">
                                    <ChevronDown size={13} className={showSource ? 'rotate-180' : ''} /> {showSource ? 'Hide' : 'Show'} original message
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
                                <button onClick={save} disabled={busy || rows.length === 0} className="btn-primary px-5 py-2 text-sm flex items-center gap-2 disabled:opacity-50">
                                    {busy ? <Spinner size="sm" color="white" label="Saving…" /> : <><Check size={15} /> Save {rows.length} promotion{rows.length === 1 ? '' : 's'}</>}
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {editIndex !== null && (
                <PromotionEditorModal
                    initial={rows[editIndex]}
                    defaultBank={bank}
                    saving={false}
                    onSave={async input => { setRows(rows.map((r, idx) => idx === editIndex ? input : r)); setEditIndex(null) }}
                    onClose={() => setEditIndex(null)}
                />
            )}
        </div>
    )
}

function ReviewRow({ row, onEdit, onRemove }: { row: BankPromotionInput; onEdit: () => void; onRemove: () => void }) {
    const agentOnly = row.audience === 'agent'
    return (
        <div className={`rounded-xl border p-3.5 ${agentOnly ? 'border-violet-200 bg-violet-50/40' : 'border-amber-200 bg-amber-50/30'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${agentOnly ? 'bg-violet-600 text-white' : 'bg-amber-500 text-white'}`}>
                            {agentOnly ? <><Users size={10} /> Agent only</> : <><Gift size={10} /> Client</>}
                        </span>
                        {row.applies_to.length > 0
                            ? <span className="text-[11px] text-slate-500">{row.applies_to.join(' · ')}</span>
                            : <span className="text-[11px] text-slate-400">All case types</span>}
                        {row.clawback_years != null && <span className="text-[11px] text-slate-400">{row.clawback_years}y clawback</span>}
                        {row.affects_ltv && <span className="text-[10px] font-semibold text-amber-700">Affects LTV</span>}
                    </div>
                    <p className="text-[13px] font-semibold text-slate-800 mt-1.5">{row.title}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        {row.starts_on || row.ends_on
                            ? <>{WINDOW_BASIS_LABELS[row.window_basis]} {row.ends_on ?? '—'}{row.starts_on ? ` (from ${row.starts_on})` : ''}</>
                            : <span className="text-amber-700">No dates found — add them before publishing</span>}
                    </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    <button onClick={onEdit} title="Edit" className="p-1.5 text-slate-400 hover:text-[#03a9e7] hover:bg-white rounded-lg"><Pencil size={14} /></button>
                    <button onClick={onRemove} title="Remove" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-white rounded-lg"><Trash2 size={14} /></button>
                </div>
            </div>

            <div className="mt-2 rounded-lg bg-white border border-slate-100 p-2 space-y-0.5">
                {row.benefit_tiers.length === 0
                    ? <p className="text-[12px] text-amber-700">No benefit tiers found — edit this row to add one.</p>
                    : row.benefit_tiers.map((t, i) => (
                        <p key={i} className="text-[12px] text-slate-600 tabular-nums">
                            {t.min_loan > 0 || t.max_loan != null
                                ? <>{shortLoan(t.min_loan)}{t.max_loan != null ? ` – ${shortLoan(t.max_loan)}` : '+'} → </>
                                : <>Any loan size → </>}
                            <span className="font-semibold text-slate-800">
                                {t.amount != null ? money(t.amount) : `${t.percent}%`}
                            </span>
                        </p>
                    ))}
            </div>

            {row.conditions.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                    {row.conditions.map((c, i) => (
                        <li key={i} className="text-[11px] text-slate-500 flex gap-1"><span className="text-amber-400 shrink-0">›</span>{c}</li>
                    ))}
                </ul>
            )}
        </div>
    )
}
