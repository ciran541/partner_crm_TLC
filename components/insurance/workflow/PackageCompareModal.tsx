'use client'

import { X } from 'lucide-react'
import type { MortgagePackage } from '@/lib/types/rates'
import { formatRateSchedule } from '@/lib/insurance/rateSchedule'
import { packageStyle, stripBankPrefix, shortLoan } from '@/lib/insurance/rateFilters'

/** Normalised shape both workflow recommenders build their two compared packages into. */
export interface ComparePackageItem {
    pkg: MortgagePackage
    year1Pct: number | null
    monthly: number | null
    avgLockinPct: number | null
    monthlySaving?: number | null   // refinancing only
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`
const pct = (n: number | null) => (n != null ? `${n.toFixed(2)}%` : '—')
const styleLabel = (s: 'flexi' | 'traditional' | null) => (s === 'flexi' ? 'Flexi' : s === 'traditional' ? 'Traditional' : '—')

/** Side-by-side comparison of exactly two packages. The better value on each
 *  comparable metric (rate / monthly / saving) is highlighted in the accent colour. */
export default function PackageCompareModal({ items, showSavings, onClose }: {
    items: ComparePackageItem[]
    showSavings?: boolean
    onClose: () => void
}) {
    const [a, b] = items
    // 0 → a is better, 1 → b is better, -1 → tie / not comparable
    const lowerBetter  = (x: number | null, y: number | null) => (x == null || y == null ? -1 : x < y ? 0 : x > y ? 1 : -1)
    const higherBetter = (x: number | null, y: number | null) => (x == null || y == null ? -1 : x > y ? 0 : x < y ? 1 : -1)

    const rows: { label: string; a: string; b: string; best: number }[] = [
        { label: 'Year-1 rate',       a: pct(a.year1Pct),     b: pct(b.year1Pct),     best: lowerBetter(a.year1Pct, b.year1Pct) },
        { label: 'Avg rate (lock-in)', a: pct(a.avgLockinPct), b: pct(b.avgLockinPct), best: lowerBetter(a.avgLockinPct, b.avgLockinPct) },
        { label: 'Est. monthly',      a: a.monthly != null ? money(a.monthly) : '—', b: b.monthly != null ? money(b.monthly) : '—', best: lowerBetter(a.monthly, b.monthly) },
        ...(showSavings ? [{ label: 'Monthly saving', a: a.monthlySaving != null ? money(a.monthlySaving) : '—', b: b.monthlySaving != null ? money(b.monthlySaving) : '—', best: higherBetter(a.monthlySaving ?? null, b.monthlySaving ?? null) }] : []),
        { label: 'Lock-in',           a: a.pkg.lockin_years ? `${a.pkg.lockin_years}Y` : 'None', b: b.pkg.lockin_years ? `${b.pkg.lockin_years}Y` : 'None', best: -1 },
        { label: 'Type',              a: styleLabel(packageStyle(a.pkg)), b: styleLabel(packageStyle(b.pkg)), best: -1 },
        { label: 'Min loan',          a: shortLoan(a.pkg.min_loan_size), b: shortLoan(b.pkg.min_loan_size), best: -1 },
    ]

    const cell = (text: string, isBest: boolean) => (
        <div className={`text-sm tabular-nums ${isBest ? 'font-bold text-[#03a9e7]' : 'font-medium text-slate-700'}`}>{text}</div>
    )

    return (
        <div className="fixed inset-0 z-[100] bg-[#052d4a]/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="text-base font-bold text-[#052d4a]">Compare packages</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400"><X size={20} /></button>
                </div>

                <div className="overflow-y-auto p-5 space-y-4">
                    {/* Titles */}
                    <div className="grid grid-cols-[120px_1fr_1fr] gap-3 items-end">
                        <div />
                        {items.map((it, i) => (
                            <div key={i} className="min-w-0">
                                <p className="text-sm font-bold text-[#052d4a] truncate">{it.pkg.bank}</p>
                                <p className="text-[11px] text-slate-500 truncate">{stripBankPrefix(it.pkg.package_name, it.pkg.bank)}</p>
                            </div>
                        ))}
                    </div>

                    {/* Metric rows */}
                    <div className="rounded-xl border border-slate-100 divide-y divide-slate-100">
                        {rows.map((r, i) => (
                            <div key={i} className="grid grid-cols-[120px_1fr_1fr] gap-3 items-center px-3 py-2">
                                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{r.label}</span>
                                {cell(r.a, r.best === 0)}
                                {cell(r.b, r.best === 1)}
                            </div>
                        ))}
                    </div>

                    {/* Rate schedule */}
                    <div>
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Rate schedule</p>
                        <div className="grid grid-cols-2 gap-3">
                            {items.map((it, i) => (
                                <ul key={i} className="space-y-0.5 text-[11px] text-slate-600">
                                    {formatRateSchedule(it.pkg.rate_schedule).map((l, j) => <li key={j} className="flex gap-1.5"><span className="text-slate-300">•</span>{l}</li>)}
                                </ul>
                            ))}
                        </div>
                    </div>

                    {/* Features */}
                    {(a.pkg.features?.length > 0 || b.pkg.features?.length > 0) && (
                        <div>
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Features</p>
                            <div className="grid grid-cols-2 gap-3">
                                {items.map((it, i) => (
                                    <ul key={i} className="space-y-0.5 text-[11px] text-slate-600">
                                        {it.pkg.features?.length
                                            ? it.pkg.features.map((f, j) => <li key={j} className="flex gap-1.5"><span className="text-emerald-400">✓</span>{f}</li>)
                                            : <li className="text-slate-300">—</li>}
                                    </ul>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Subsidies */}
                    {(a.pkg.subsidies || b.pkg.subsidies) && (
                        <div>
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Subsidies</p>
                            <div className="grid grid-cols-2 gap-3 text-[11px] text-slate-600">
                                <p>{a.pkg.subsidies || '—'}</p>
                                <p>{b.pkg.subsidies || '—'}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
