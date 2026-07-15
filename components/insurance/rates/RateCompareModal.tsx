'use client'

import { useMemo, useState } from 'react'
import { MortgagePackage, RateScheduleEntry } from '@/lib/types/rates'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import { effectiveRate, projectPackage } from '@/lib/insurance/rateRecommend'
import { shortLoan, stripBankPrefix, packageStyle } from '@/lib/insurance/rateFilters'
import type { SoraRates } from '@/lib/insurance/sora'
import { X, Lock, LockOpen, GitCompare, Download, Mail, Loader2 } from 'lucide-react'

// Effective first-year rate for the column headline, mirroring the card's big number.
function firstYearRate(schedule: RateScheduleEntry[], sora: SoraRates | null): string {
    const first = schedule?.[0]
    if (!first) return '—'
    const { rate } = effectiveRate(first, sora)
    if (rate != null) return `${rate.toFixed(2)}%`
    if (first.type === 'floating') return first.spread != null ? `+${first.spread.toFixed(2)}%` : (first.reference || '—')
    return '—'
}

// One package's rate entry for a given year (null when its schedule is shorter).
function cellForYear(pkg: MortgagePackage, year: number, sora: SoraRates | null) {
    const e = pkg.rate_schedule.find(x => !x.thereafter && typeof x.year === 'number' && x.year === year)
    if (!e) return null
    const text = formatRateEntry(e).split(': ').slice(1).join(': ')
    const { rate } = e.type === 'floating' ? effectiveRate(e, sora) : { rate: e.rate ?? null }
    const inLockin = year <= pkg.lockin_years
    return { text, rate, inLockin }
}

function thereafterCell(pkg: MortgagePackage, sora: SoraRates | null) {
    const e = pkg.rate_schedule.find(x => x.thereafter)
    if (!e) return null
    const text = formatRateEntry(e).split(': ').slice(1).join(': ')
    const { rate } = e.type === 'floating' ? effectiveRate(e, sora) : { rate: e.rate ?? null }
    return { text, rate }
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

export default function RateCompareModal({
    packages, sora, initialLoan, initialTenure, caseId, clientEmail, clientName, onRemove, onClose,
}: {
    packages: MortgagePackage[]
    sora: SoraRates | null
    initialLoan: number | null
    initialTenure?: number | null
    caseId?: string            // present in a workflow → enables "Email to client"
    clientEmail?: string       // the case's stored client email (recipient)
    clientName?: string
    onRemove: (id: string) => void
    onClose: () => void
}) {
    const [loanInput, setLoanInput] = useState(initialLoan ? String(initialLoan) : '')
    const [tenureInput, setTenureInput] = useState(initialTenure ? String(initialTenure) : '25')
    const [busy, setBusy] = useState<null | 'pdf' | 'email'>(null)
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
    const [confirmEmail, setConfirmEmail] = useState(false)
    const canEmail = !!(caseId && clientEmail)

    const loan = useMemo(() => {
        const n = parseFloat(loanInput.replace(/[,$\s]/g, ''))
        return isFinite(n) && n >= 100_000 ? n : null
    }, [loanInput])
    const tenure = useMemo(() => {
        const n = parseInt(tenureInput, 10)
        return isFinite(n) && n >= 5 && n <= 35 ? n : null
    }, [tenureInput])

    // Every year present across the compared packages, so rows line up by year.
    const maxYear = useMemo(() =>
        packages.reduce((m, p) => Math.max(m, ...p.rate_schedule
            .filter(e => !e.thereafter && typeof e.year === 'number')
            .map(e => e.year as number)), 0),
        [packages])
    const years = Array.from({ length: maxYear }, (_, i) => i + 1)
    const anyThereafter = packages.some(p => p.rate_schedule.some(e => e.thereafter))

    const projections = useMemo(() =>
        packages.map(p => (loan && tenure) ? projectPackage(p, loan, tenure, sora) : null),
        [packages, loan, tenure, sora])

    // 128px label column + a min per package column so 2–3 columns scroll on narrow screens.
    const minWidth = 128 + packages.length * 210

    const payload = () => ({
        packageIds: packages.map(p => p.id),
        ...(loan != null ? { loan } : {}),
        ...(tenure != null ? { tenure } : {}),
    })

    const handlePdf = async () => {
        setBusy('pdf'); setMsg(null)
        try {
            const res = await fetch('/api/insurance/rates/compare-pdf', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload(), clientName }),
            })
            if (!res.ok) {
                const j = await res.json().catch(() => ({}))
                throw new Error(j.error || 'Could not generate the PDF')
            }
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'mortgage-package-comparison.pdf'
            document.body.appendChild(a); a.click(); a.remove()
            URL.revokeObjectURL(url)
        } catch (e) {
            setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to export PDF' })
        } finally { setBusy(null) }
    }

    const handleEmail = async () => {
        if (!caseId) return
        setBusy('email'); setMsg(null); setConfirmEmail(false)
        try {
            const res = await fetch(`/api/insurance/cases/${caseId}/send-comparison`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload()),
            })
            const j = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(j.error || 'Could not send the email')
            setMsg({ ok: true, text: `Sent to ${j.sentTo || clientEmail}` })
        } catch (e) {
            setMsg({ ok: false, text: e instanceof Error ? e.message : 'Failed to send email' })
        } finally { setBusy(null) }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 backdrop-blur-sm p-4 overflow-y-auto"
            onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-5xl my-8"
                onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                    <h2 className="text-base font-bold text-[#052d4a] flex items-center gap-2">
                        <GitCompare size={18} className="text-[#03a9e7]" />
                        Compare {packages.length} package{packages.length !== 1 ? 's' : ''}
                    </h2>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Estimate controls */}
                <div className="px-5 py-3 bg-slate-50/60 border-b border-slate-100 flex flex-wrap items-end gap-4">
                    <div>
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Loan Amount</label>
                        <div className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                            <input type="text" inputMode="numeric" value={loanInput} onChange={e => setLoanInput(e.target.value)}
                                placeholder="e.g. 500000"
                                className="w-36 pl-5 pr-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-[#03a9e7] tabular-nums" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Tenure (yrs)</label>
                        <input type="text" inputMode="numeric" value={tenureInput} onChange={e => setTenureInput(e.target.value)}
                            className="w-20 px-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-[#03a9e7] tabular-nums" />
                    </div>
                    <p className="text-[11px] text-slate-400 pb-1.5 leading-snug">
                        {loan && tenure
                            ? 'Estimated monthly repayments below re-amortise at each year’s rate.'
                            : 'Enter loan ≥ $100k and tenure 5–35y to estimate monthly repayments.'}
                    </p>
                </div>

                {/* Comparison grid */}
                <div className="overflow-x-auto">
                    <div style={{ minWidth: `${minWidth}px` }}>
                        {/* Header row — bank + name + headline rate */}
                        <div className="flex">
                            <div className="w-32 shrink-0 bg-white" />
                            {packages.map(pkg => {
                                const locked = pkg.lockin_years > 0
                                return (
                                    <div key={pkg.id} className="flex-1 min-w-[210px] px-3 py-3 border-l border-slate-100">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-[#052d4a] truncate flex items-center gap-1">
                                                    {locked ? <Lock size={11} className="text-slate-400 shrink-0" /> : <LockOpen size={11} className="text-slate-400 shrink-0" />}
                                                    {pkg.bank}
                                                </p>
                                                <p className="text-xs text-slate-500 truncate">{stripBankPrefix(pkg.package_name, pkg.bank)}</p>
                                            </div>
                                            <button onClick={() => onRemove(pkg.id)} title="Remove from comparison"
                                                className="text-slate-300 hover:text-red-400 shrink-0 transition-colors">
                                                <X size={14} />
                                            </button>
                                        </div>
                                        <p className="text-lg font-bold text-[#03a9e7] tabular-nums mt-1.5">{firstYearRate(pkg.rate_schedule, sora)}</p>
                                    </div>
                                )
                            })}
                        </div>

                        <Row label="Lock-in">
                            {packages.map(pkg => (
                                <Cell key={pkg.id}>{pkg.lockin_years > 0 ? `${pkg.lockin_years} year${pkg.lockin_years !== 1 ? 's' : ''}` : 'None'}</Cell>
                            ))}
                        </Row>

                        <Row label="Property">
                            {packages.map(pkg => <Cell key={pkg.id}>{pkg.property_type}</Cell>)}
                        </Row>

                        <Row label="Min. loan">
                            {packages.map(pkg => <Cell key={pkg.id}>{shortLoan(pkg.min_loan_size)}</Cell>)}
                        </Row>

                        <Row label="Style">
                            {packages.map(pkg => {
                                const style = packageStyle(pkg)
                                return <Cell key={pkg.id}>{style ? (style === 'flexi' ? 'Flexi (free conversion)' : 'Traditional') : '—'}</Cell>
                            })}
                        </Row>

                        {/* Rate schedule, aligned by year */}
                        <SectionLabel>Rate schedule</SectionLabel>
                        {years.map(year => (
                            <Row key={year} label={`Year ${year}`}>
                                {packages.map(pkg => {
                                    const c = cellForYear(pkg, year, sora)
                                    if (!c) return <Cell key={pkg.id} muted>—</Cell>
                                    return (
                                        <Cell key={pkg.id}>
                                            <span className="flex items-center gap-1.5">
                                                {c.inLockin && <span className="w-1 h-1 rounded-full bg-[#03a9e7] shrink-0" title="Within lock-in" />}
                                                <span>{c.text}</span>
                                                {c.rate != null && <span className="text-[#0277a8] text-[11px]">({c.rate.toFixed(2)}%)</span>}
                                            </span>
                                        </Cell>
                                    )
                                })}
                            </Row>
                        ))}
                        {anyThereafter && (
                            <Row label="Thereafter">
                                {packages.map(pkg => {
                                    const c = thereafterCell(pkg, sora)
                                    if (!c) return <Cell key={pkg.id} muted>—</Cell>
                                    return (
                                        <Cell key={pkg.id}>
                                            {c.text}
                                            {c.rate != null && <span className="text-[#0277a8] text-[11px] ml-1">({c.rate.toFixed(2)}%)</span>}
                                        </Cell>
                                    )
                                })}
                            </Row>
                        )}

                        {/* Estimated repayments */}
                        {loan && tenure && (
                            <>
                                <SectionLabel>Estimated monthly repayment · {money(loan)} over {tenure}y</SectionLabel>
                                <Row label="Year 1">
                                    {packages.map((pkg, i) => {
                                        const inst = projections[i]?.perYear[0]?.installment
                                        return <Cell key={pkg.id} muted={inst == null}>{inst != null ? money(inst) : 'Not priced'}</Cell>
                                    })}
                                </Row>
                                <Row label={`Avg over lock-in`}>
                                    {packages.map((pkg, i) => {
                                        const m = projections[i]?.newMonthly
                                        return <Cell key={pkg.id} muted={m == null}>{m != null ? money(m) : '—'}</Cell>
                                    })}
                                </Row>
                            </>
                        )}

                        {/* Features */}
                        <SectionLabel>Features</SectionLabel>
                        <Row label="" >
                            {packages.map(pkg => (
                                <Cell key={pkg.id}>
                                    {pkg.features.length ? (
                                        <ul className="space-y-1">
                                            {pkg.features.map((f, i) => (
                                                <li key={i} className="flex gap-1.5 text-[11px] text-slate-500 leading-snug">
                                                    <span className="text-[#03a9e7] shrink-0">›</span><span>{f}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : <span className="text-slate-300">—</span>}
                                </Cell>
                            ))}
                        </Row>

                        {/* Subsidies */}
                        <Row label="Subsidy">
                            {packages.map(pkg => (
                                <Cell key={pkg.id} muted={!pkg.subsidies}>
                                    {pkg.subsidies || '—'}
                                </Cell>
                            ))}
                        </Row>
                    </div>
                </div>

                {/* Footer actions */}
                <div className="flex items-center justify-between gap-3 flex-wrap px-5 py-3 border-t border-slate-100 bg-slate-50/50">
                    <div className="text-[12px] min-h-[18px]">
                        {msg && <span className={msg.ok ? 'text-emerald-600 font-medium' : 'text-red-500'}>{msg.text}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                        {canEmail && (confirmEmail ? (
                            <span className="inline-flex items-center gap-2 text-[12px] text-slate-600">
                                Send to <b className="text-slate-800">{clientEmail}</b>?
                                <button onClick={handleEmail} className="font-semibold text-[#03a9e7] hover:underline">Send</button>
                                <button onClick={() => setConfirmEmail(false)} className="text-slate-400 hover:underline">Cancel</button>
                            </span>
                        ) : (
                            <button onClick={() => { setConfirmEmail(true); setMsg(null) }} disabled={busy !== null}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] disabled:opacity-50 transition-colors">
                                {busy === 'email' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Email to client
                            </button>
                        ))}
                        <button onClick={handlePdf} disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#03a9e7] text-white hover:bg-[#0298d0] disabled:opacity-50 transition-colors">
                            {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export PDF
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── Row / cell primitives ──────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex border-t border-slate-100">
            <div className="w-32 shrink-0 px-3 py-2.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50/50 flex items-center">
                {label}
            </div>
            {children}
        </div>
    )
}

function Cell({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
    return (
        <div className={`flex-1 min-w-[210px] px-3 py-2.5 border-l border-slate-100 text-[12px] tabular-nums ${muted ? 'text-slate-300' : 'text-slate-700'}`}>
            {children}
        </div>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {children}
        </div>
    )
}
