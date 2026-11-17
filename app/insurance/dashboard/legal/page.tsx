'use client'

import { useState, type ReactNode } from 'react'
import { Scale, Phone, MapPin, Info } from 'lucide-react'
// Ban list (BANNED_FIRMS) and per-firm notes are hidden for now — the data
// stays in legalFees.ts so either can be switched back on.
import {
    PANEL_BANKS, PANEL_NOTE, FEE_TYPES, FEE_GROUPS, PRICE_NOTE, LAW_FIRMS, LEGAL_VERIFY,
    type PanelBank, type FeeGroup, type LawFirm,
} from '@/lib/insurance/legalFees'

type View = 'panel' | 'prices'

// "93273185" → "9327 3185" — easier to read off an iPad to a client.
function formatPhone(n: string): string {
    return n.length === 8 ? `${n.slice(0, 4)} ${n.slice(4)}` : n
}

export default function LegalPage() {
    const [view, setView] = useState<View>('panel')

    return (
        <div className="max-w-[1100px] mx-auto">
            {/* Header */}
            <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between mb-8">
                <div>
                    <h1 className="ios-page-title flex items-center gap-2.5">
                        <span className="w-9 h-9 rounded-xl bg-sky-100 flex items-center justify-center shrink-0">
                            <Scale size={18} className="text-[#03a9e7]" />
                        </span>
                        Legal
                    </h1>
                    <p className="page-subtitle mt-1">Conveyancing panel and fee references for your client.</p>
                </div>

                <Segmented
                    value={view}
                    onChange={setView}
                    options={[
                        { value: 'panel', label: 'Bank Panel' },
                        { value: 'prices', label: 'Price List' },
                    ]}
                />
            </header>

            {view === 'panel' ? <PanelView /> : <PriceView />}

            <p className="mt-10 text-xs text-slate-400 text-center leading-relaxed">
                Reference figures from the desk&apos;s law-firm sheet and may change without notice.
                Confirm with the firm before quoting a client.
            </p>
        </div>
    )
}

// ── Bank panel ─────────────────────────────────────────────────────────────

function PanelView() {
    // The real question an agent asks: "which firm can I use for this bank?"
    const [bank, setBank] = useState<PanelBank | null>(null)
    const firms = bank ? LAW_FIRMS.filter(f => f.panel[bank]) : LAW_FIRMS

    return (
        <div className="space-y-6">
            <div>
                <p className="text-[13px] font-medium text-slate-500 mb-2.5">Filter by bank</p>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
                    <Chip active={bank === null} onClick={() => setBank(null)}>All banks</Chip>
                    {PANEL_BANKS.map(b => (
                        <Chip key={b} active={bank === b} onClick={() => setBank(bank === b ? null : b)}>{b}</Chip>
                    ))}
                </div>
            </div>

            <Hint>{PANEL_NOTE}</Hint>

            {firms.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                    {firms.map(f => <FirmCard key={f.name} firm={f} highlight={bank} />)}
                </div>
            ) : (
                <div className="rounded-3xl bg-white border border-slate-200/70 py-16 text-center">
                    <p className="text-[15px] font-medium text-slate-700">No firm on {bank}&apos;s panel</p>
                    <p className="text-sm text-slate-400 mt-1">None of the firms in this list are on that bank&apos;s panel.</p>
                </div>
            )}
        </div>
    )
}

function FirmCard({ firm, highlight }: { firm: LawFirm; highlight: PanelBank | null }) {
    const onPanel = PANEL_BANKS.filter(b => firm.panel[b])
    const offPanel = PANEL_BANKS.filter(b => !firm.panel[b])
    const initials = firm.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('')

    return (
        <article className="rounded-3xl bg-white border border-slate-200/70 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col">
            <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-semibold shrink-0">
                    {initials}
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="text-[17px] font-semibold text-slate-900 leading-snug">{firm.name}</h3>
                    <p className="mt-1 text-[13px] text-slate-500 inline-flex items-center gap-1">
                        <MapPin size={13} className="text-slate-400" /> {firm.location}
                    </p>
                </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                    <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Contact</p>
                    <p className="text-[15px] font-medium text-slate-800">{firm.contact}</p>
                </div>
                <a
                    href={`tel:${firm.mobile}`}
                    className="inline-flex items-center gap-2 rounded-full bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:scale-[0.98] transition"
                >
                    <Phone size={14} className="text-[#03a9e7]" />
                    {formatPhone(firm.mobile)}
                </a>
            </div>

            <div className="mt-5">
                <p className="text-[13px] font-medium text-slate-500 mb-2">
                    On panel <span className="text-slate-400 font-normal">· {onPanel.length} of {PANEL_BANKS.length} banks</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                    {onPanel.map(b => (
                        <span
                            key={b}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                highlight === b ? 'bg-[#03a9e7] text-white' : 'bg-sky-50 text-sky-700'
                            }`}
                        >
                            {b}
                        </span>
                    ))}
                </div>
                {offPanel.length > 0 && (
                    <p className="mt-3 text-xs text-slate-400">
                        Not on: {offPanel.join(', ')}
                    </p>
                )}
            </div>
        </article>
    )
}

// ── Price list ─────────────────────────────────────────────────────────────

function PriceView() {
    const [group, setGroup] = useState<FeeGroup | null>(null)
    const groups = group ? [group] : FEE_GROUPS

    return (
        <div className="space-y-6">
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
                <Chip active={group === null} onClick={() => setGroup(null)}>All fees</Chip>
                {FEE_GROUPS.map(g => (
                    <Chip key={g} active={group === g} onClick={() => setGroup(group === g ? null : g)}>{g}</Chip>
                ))}
            </div>

            <Hint>{PRICE_NOTE}</Hint>

            <div className="rounded-3xl bg-white border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm border-separate border-spacing-0">
                        <thead>
                            <tr>
                                <th className="sticky left-0 z-20 bg-white text-left px-5 py-4 text-[12px] font-medium text-slate-400 min-w-[180px] border-b border-slate-100">
                                    Fee type
                                </th>
                                {LAW_FIRMS.map(f => (
                                    <th key={f.name} className="text-left px-4 py-4 text-[13px] font-semibold text-slate-800 min-w-[150px] align-bottom border-b border-slate-100">
                                        {f.name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {groups.map(g => (
                                <GroupRows key={g} group={g} showHeading={group === null} />
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {LEGAL_VERIFY.length > 0 && (
                <Hint>
                    A few cells were hard to read off the sheet and are best-guess: {LEGAL_VERIFY.join('; ')}
                </Hint>
            )}
        </div>
    )
}

function GroupRows({ group, showHeading }: { group: FeeGroup; showHeading: boolean }) {
    const rows = FEE_TYPES.filter(ft => ft.group === group)
    return (
        <>
            {showHeading && (
                <tr>
                    <td
                        colSpan={LAW_FIRMS.length + 1}
                        className="sticky left-0 bg-slate-50/80 px-5 pt-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
                    >
                        {group}
                    </td>
                </tr>
            )}
            {rows.map(ft => (
                <tr key={ft.key} className="group">
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 px-5 py-3.5 align-top text-slate-700 font-medium border-b border-slate-100 transition-colors">
                        {ft.label}
                    </td>
                    {LAW_FIRMS.map(f => (
                        <td key={f.name} className="px-4 py-3.5 align-top border-b border-slate-100 group-hover:bg-slate-50 transition-colors">
                            <Fee text={f.fees[ft.key]} />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    )
}

function Fee({ text }: { text: string }) {
    if (text.trim().toUpperCase().startsWith('N/A')) {
        return <span className="text-slate-300">—</span>
    }
    // "$1,700\n(condition)" → the figure, then a quieter condition line.
    const [main, ...rest] = text.split('\n')
    return (
        <div className="leading-snug">
            <p className="font-semibold text-slate-900 tabular-nums">{main}</p>
            {rest.length > 0 && <p className="text-xs text-slate-400 mt-0.5">{rest.join(' ')}</p>}
        </div>
    )
}

// ── Primitives ─────────────────────────────────────────────────────────────

function Segmented<T extends string>({ value, onChange, options }: {
    value: T
    onChange: (v: T) => void
    options: { value: T; label: string }[]
}) {
    return (
        <div className="inline-flex self-start rounded-full bg-slate-200/60 p-1">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    onClick={() => onChange(o.value)}
                    className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
                        value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`shrink-0 px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
                active ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
        >
            {children}
        </button>
    )
}

function Hint({ children }: { children: ReactNode }) {
    return (
        <p className="flex items-start gap-2 text-[13px] text-slate-500 leading-relaxed">
            <Info size={15} className="text-slate-400 shrink-0 mt-0.5" />
            <span>{children}</span>
        </p>
    )
}
