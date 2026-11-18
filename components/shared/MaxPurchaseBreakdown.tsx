import type { MaxPurchaseBreakdown as Breakdown } from '@/lib/insurance/purchaseCalc'

// "Max purchase price" block under each Affordability loan option — the purchase
// workflow run backwards (loan ÷ LTV = price, then downpayment + fees on that
// price). Shared by the Premium and property-app Affordability pages.

function fmt(n: number): string {
    return Math.round(n).toLocaleString('en-SG')
}

const pct = (f: number) => `${+(f * 100).toFixed(2)}%`

export default function MaxPurchaseBreakdown({ b, accent }: { b: Breakdown; accent: string }) {
    return (
        <div className="pt-5 border-t border-slate-100 space-y-3">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Max Purchase Price</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Loan ÷ {pct(b.ltvPct)} LTV</p>
                </div>
                <p className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: accent }}>${fmt(b.price)}</p>
            </div>

            <div className="rounded-xl border border-slate-100 overflow-hidden text-[13px]">
                <Group title="Downpayment" total={b.minCash + b.cashCpf}>
                    <Row label="Cash" tag={pct(b.minCashPct)} value={b.minCash} />
                    <Row label="Cash / CPF" tag={pct(b.cashCpfPct)} value={b.cashCpf} />
                </Group>
                <Group title="Misc Fees" total={b.fees}>
                    <Row label="BSD" value={b.bsd} />
                    <Row label="ABSD" tag={`${+b.absdRatePct.toFixed(2)}%`} value={b.absd} />
                    <Row label="Legal (est.)" value={b.legalFee} />
                    <Row label="Valuation (est.)" value={b.valuationFee} />
                </Group>
                <div
                    className="flex items-center justify-between px-3.5 py-2.5 border-t border-slate-100"
                    style={{ backgroundColor: `${accent}0d` }}
                >
                    <span className="text-xs font-semibold text-[#052d4a]">
                        Total upfront <span className="font-normal text-slate-400">· excl. loan</span>
                    </span>
                    <span className="text-sm font-bold text-[#052d4a] tabular-nums">${fmt(b.totalUpfront)}</span>
                </div>
            </div>
        </div>
    )
}

function Group({ title, total, children }: { title: string; total: number; children: React.ReactNode }) {
    return (
        <div className="border-b border-slate-100 last:border-b-0">
            <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-50/80">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{title}</span>
                <span className="text-[11px] font-semibold text-slate-500 tabular-nums">${fmt(total)}</span>
            </div>
            <div className="px-3.5 py-1.5">{children}</div>
        </div>
    )
}

function Row({ label, tag, value }: { label: string; tag?: string; value: number }) {
    return (
        <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-500">
                {label}
                {tag && <span className="ml-1.5 text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-px rounded">{tag}</span>}
            </span>
            <span className="text-slate-700 font-medium tabular-nums">${fmt(value)}</span>
        </div>
    )
}
