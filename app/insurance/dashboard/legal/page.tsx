'use client'

import { useState, type ReactNode } from 'react'
import { Scale, Ban, Building2, Receipt, Info, Check, Minus, Phone, MapPin } from 'lucide-react'
import {
    BANNED_FIRMS, PANEL_BANKS, PANEL_NOTE, FEE_TYPES, PRICE_NOTE, LAW_FIRMS, LEGAL_VERIFY,
    type PanelBank, type LawFirm,
} from '@/lib/insurance/legalFees'

// Pinned first column: a solid background (set per-row) plus a soft right-edge
// shadow so it reads as anchored while the rest of a wide table scrolls under it.
const STICKY = 'sticky left-0 z-10 border-r border-slate-200 shadow-[2px_0_5px_-2px_rgba(15,23,42,0.08)]'

// One row background rule, reused by the <tr> and its own sticky cell (which must
// be opaque to cover cells sliding beneath it). Plain zebra — every firm rendered
// the same, no per-firm highlighting.
function rowBg(i: number): string {
    return i % 2 ? 'bg-slate-50/40' : 'bg-white'
}

export default function LegalPage() {
    // Filter the panel to firms on a chosen bank's panel — the real question an
    // agent asks ("which firm can I use for this bank?").
    const [bankFilter, setBankFilter] = useState<PanelBank | ''>('')
    const panelFirms = bankFilter ? LAW_FIRMS.filter(f => f.panel[bankFilter]) : LAW_FIRMS

    return (
        <div className="max-w-[1400px] mx-auto space-y-6">
            {/* Header */}
            <div>
                <h1 className="ios-page-title flex items-center gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                        <Scale size={18} className="text-[#03a9e7]" />
                    </span>
                    Legal
                </h1>
                <p className="page-subtitle mt-1">Conveyancing panel and fee references for your client.</p>
            </div>

            {/* ── Ban list ── */}
            <section className="rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-red-50/30 overflow-hidden">
                <div className="flex items-center gap-2.5 px-5 pt-4">
                    <span className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                        <Ban size={15} className="text-red-600" />
                    </span>
                    <div>
                        <h2 className="text-sm font-bold text-red-700">Ban List</h2>
                        <p className="text-[11px] text-red-500/90">Do not instruct these firms on any case.</p>
                    </div>
                </div>
                <div className="px-5 py-4 flex flex-wrap gap-2">
                    {BANNED_FIRMS.map(f => (
                        <span key={f} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/80 border border-red-200 text-sm font-semibold text-red-700">
                            {f}
                        </span>
                    ))}
                </div>
            </section>

            {/* ── Bank panel ── */}
            <SectionCard
                icon={<Building2 size={15} className="text-[#03a9e7]" />}
                title="Bank Panel"
                meta={`${panelFirms.length} of ${LAW_FIRMS.length} firms`}
            >
                {/* Filter row */}
                <div className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-b border-slate-100">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mr-1">On panel for</span>
                    <button
                        onClick={() => setBankFilter('')}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                            !bankFilter ? 'bg-[#052d4a] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                    >
                        All
                    </button>
                    {PANEL_BANKS.map(b => (
                        <button
                            key={b}
                            onClick={() => setBankFilter(b === bankFilter ? '' : b)}
                            className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                                bankFilter === b ? 'bg-[#03a9e7] text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                        >
                            {b}
                        </button>
                    ))}
                </div>

                <NoteStrip>{PANEL_NOTE}</NoteStrip>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wide">
                                <th className={`${STICKY} bg-slate-50 px-4 py-2.5 font-semibold min-w-[230px]`}>Law Firm</th>
                                <th className="bg-slate-50/70 px-3 py-2.5 font-semibold whitespace-nowrap">Contact</th>
                                {PANEL_BANKS.map(b => (
                                    <th key={b}
                                        className={`px-2 py-2.5 font-semibold text-center whitespace-nowrap transition-colors ${bankFilter === b ? 'text-[#03a9e7] bg-sky-50' : 'bg-slate-50/70'}`}>
                                        {b}
                                    </th>
                                ))}
                                <th className="bg-slate-50/70 px-3 py-2.5 font-semibold whitespace-nowrap">Location</th>
                            </tr>
                        </thead>
                        <tbody>
                            {panelFirms.map((firm, i) => (
                                <tr key={firm.name} className={`border-t border-slate-100 ${rowBg(i)}`}>
                                    <td className={`${STICKY} ${rowBg(i)} px-4 py-3 align-top`}>
                                        <FirmName firm={firm} />
                                    </td>
                                    <td className="px-3 py-3 align-top whitespace-nowrap">
                                        <p className="text-slate-700">{firm.contact}</p>
                                        <a href={`tel:${firm.mobile}`} className="text-[11px] text-slate-400 hover:text-[#03a9e7] inline-flex items-center gap-1 transition-colors">
                                            <Phone size={10} /> {firm.mobile}
                                        </a>
                                    </td>
                                    {PANEL_BANKS.map(b => (
                                        <td key={b} className={`px-2 py-3 text-center align-middle ${bankFilter === b ? 'bg-sky-50/70' : ''}`}>
                                            <PanelMark on={firm.panel[b]} />
                                        </td>
                                    ))}
                                    <td className="px-3 py-3 align-top whitespace-nowrap text-slate-600">
                                        <span className="inline-flex items-center gap-1"><MapPin size={11} className="text-slate-400" /> {firm.location}</span>
                                    </td>
                                </tr>
                            ))}
                            {panelFirms.length === 0 && (
                                <tr><td colSpan={PANEL_BANKS.length + 3} className="px-4 py-8 text-center text-sm text-slate-400">
                                    No firm on {bankFilter}&apos;s panel in this list.
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {/* ── Price list ── */}
            <SectionCard
                icon={<Receipt size={15} className="text-[#03a9e7]" />}
                title="Price List"
                meta="Scroll for all fee types →"
            >
                <NoteStrip>{PRICE_NOTE}</NoteStrip>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="text-left text-[11px] text-slate-400 uppercase tracking-wide">
                                <th className={`${STICKY} bg-slate-50 px-4 py-2.5 font-semibold min-w-[200px]`}>Law Firm</th>
                                {FEE_TYPES.map(ft => (
                                    <th key={ft.key} className="bg-slate-50/70 px-3 py-2.5 font-semibold align-bottom min-w-[132px]">{ft.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {LAW_FIRMS.map((firm, i) => (
                                <tr key={firm.name} className={`border-t border-slate-100 ${rowBg(i)}`}>
                                    <td className={`${STICKY} ${rowBg(i)} px-4 py-3 align-top`}>
                                        <FirmName firm={firm} hideNote />
                                    </td>
                                    {FEE_TYPES.map(ft => (
                                        <td key={ft.key} className="px-3 py-3 align-top">
                                            <FeeCell text={firm.fees[ft.key]} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </SectionCard>

            {LEGAL_VERIFY.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
                    <div className="text-[12px] text-slate-500 leading-relaxed">
                        <span className="font-semibold text-slate-600">A few cells to double-check</span> — these were hard to read off the sheet and are shown as best-guess:
                        <ul className="mt-1 space-y-0.5">
                            {LEGAL_VERIFY.map(v => <li key={v} className="flex gap-1.5"><span className="text-slate-400">·</span>{v}</li>)}
                        </ul>
                    </div>
                </div>
            )}

            <p className="text-xs text-slate-400 text-center">
                Reference figures collated from the desk&apos;s law-firm sheet and may change without notice — confirm with the firm before quoting a client.
            </p>
        </div>
    )
}

// ── Building blocks ────────────────────────────────────────────────────────

function SectionCard({ icon, title, meta, children }: { icon: ReactNode; title: string; meta?: string; children: ReactNode }) {
    return (
        <section className="card !p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100">
                <h2 className="text-sm font-bold text-[#052d4a] flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-sky-100 flex items-center justify-center shrink-0">{icon}</span>
                    {title}
                </h2>
                {meta && <span className="text-[11px] text-slate-400 font-medium whitespace-nowrap">{meta}</span>}
            </div>
            {children}
        </section>
    )
}

function NoteStrip({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-start gap-2 px-5 py-2.5 bg-amber-50 border-b border-amber-100">
            <Info size={13} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-800 leading-relaxed">{children}</p>
        </div>
    )
}

function FirmName({ firm, hideNote }: { firm: LawFirm; hideNote?: boolean }) {
    return (
        <div>
            <p className="font-semibold text-[#052d4a] leading-tight">{firm.name}</p>
            {!hideNote && firm.note && <p className="text-[11px] text-red-500 mt-0.5 leading-snug">{firm.note}</p>}
        </div>
    )
}

function PanelMark({ on }: { on: boolean }) {
    return on
        ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100"><Check size={12} className="text-emerald-600" strokeWidth={3} /></span>
        : <Minus size={13} className="inline text-slate-300" strokeWidth={2.5} />
}

function FeeCell({ text }: { text: string }) {
    if (text.trim().toUpperCase().startsWith('N/A')) {
        return <span className="text-slate-300">N/A</span>
    }
    // Split "$1,700\n(condition)" into a bold figure + a smaller note line.
    const [main, ...rest] = text.split('\n')
    return (
        <div className="leading-snug">
            <p className="font-semibold text-slate-700 tabular-nums whitespace-nowrap">{main}</p>
            {rest.length > 0 && <p className="text-[10px] text-slate-400 mt-0.5">{rest.join(' ')}</p>}
        </div>
    )
}
