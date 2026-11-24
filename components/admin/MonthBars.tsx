'use client'

import { useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const THIS = '#03a9e7'
const LAST = '#cbd5e1'

/**
 * Twelve monthly bars with last year behind them. Same look and behaviour as the
 * agent Dashboard's trend: tapping a month selects it, future months are inert.
 */
export default function MonthBars({ year, lastIdx, now, before, format, selected, onSelect }: {
    year: number
    /** Last month with data to show (0–11); later months are greyed out. */
    lastIdx: number
    now: number[]
    before: number[]
    format: (n: number) => string
    selected: number | null
    onSelect: (i: number) => void
}) {
    const [hover, setHover] = useState<number | null>(null)
    const hasBefore = before.some(v => v > 0)
    const max = Math.max(1, ...now, ...before)
    const W = 720, H = 200, top = 24, base = H - 22, slot = W / 12
    const w = Math.min(22, slot * 0.32)
    const y = (v: number) => base - (Math.max(0, v) / max) * (base - top)
    const bar = (x: number, v: number) => {
        const h = base - y(v)
        if (h <= 0) return ''
        const r = Math.min(4, w / 2, h)
        return `M${x},${base} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + w - r} Q${x + w},${y(v)} ${x + w},${y(v) + r} V${base} Z`
    }
    return (
        <div>
            <div className="relative">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="group" aria-label={`Monthly figures for ${year}`} onMouseLeave={() => setHover(null)}>
                    <line x1={0} x2={W} y1={base} y2={base} stroke="#e2e8f0" />
                    {MONTHS.map((m, i) => {
                        const cx = slot * i + slot / 2
                        const future = i > lastIdx
                        const pick = () => { if (!future) onSelect(i) }
                        return (
                            <g key={m} onMouseEnter={() => setHover(i)} onClick={pick} style={{ cursor: future ? 'default' : 'pointer' }}
                                role="button" tabIndex={future ? -1 : 0} aria-disabled={future} aria-pressed={selected === i}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick() } }}
                                aria-label={`${m} ${year}: ${format(now[i])}`}>
                                <rect x={slot * i + 2} y={0} width={slot - 4} height={H} rx={8} fill={selected === i ? '#e0f2fe' : hover === i && !future ? '#f1f5f9' : 'transparent'} />
                                {hasBefore && before[i] > 0 && <path d={bar(cx - w - 1, before[i])} fill={LAST} />}
                                {!future && now[i] > 0 && <path d={bar(hasBefore ? cx + 1 : cx - w / 2, now[i])} fill={THIS} />}
                                {i === (selected ?? lastIdx) && now[i] > 0 && (
                                    <text x={hasBefore ? cx + 1 + w / 2 : cx} y={y(now[i]) - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="#052d4a">{format(now[i])}</text>
                                )}
                                <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fontWeight={selected === i ? 700 : 400} fill={future ? '#cbd5e1' : selected === i ? '#0369a1' : '#64748b'}>{m}</text>
                            </g>
                        )
                    })}
                </svg>
                {hover != null && (
                    <div className="absolute top-0 pointer-events-none rounded-lg bg-[#052d4a] text-white text-xs px-3 py-2 shadow-lg"
                        style={{ left: `clamp(0px, calc(${((hover + 0.5) / 12) * 100}% - 70px), calc(100% - 140px))`, width: 140 }}>
                        <p className="font-bold">{MONTHS[hover]}</p>
                        <p>{year}: <b>{format(now[hover])}</b></p>
                        {hasBefore && <p className="text-white/75">{year - 1}: {format(before[hover])}</p>}
                    </div>
                )}
            </div>
            {hasBefore && (
                <div className="flex gap-4 text-xs text-slate-600 mt-2">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: THIS }} /> {year}</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: LAST }} /> {year - 1}</span>
                </div>
            )}
        </div>
    )
}
