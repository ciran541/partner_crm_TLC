'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { periodLabel } from '@/lib/insurance/earningsStatement'

/** Download the statement for the month or year picked on Earnings. */
export default function StatementButton({ period, agentId }: { period: string; agentId?: string }) {
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const download = async () => {
        setBusy(true); setErr(null)
        try {
            const res = await fetch(`/api/insurance/earnings/statement?period=${period}${agentId ? `&agent=${agentId}` : ''}`)
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not prepare the statement.')
            const url = URL.createObjectURL(await res.blob())
            const a = document.createElement('a')
            a.href = url
            a.download = `Earnings-${period}.pdf`
            document.body.appendChild(a); a.click(); a.remove()
            // Safari still reads the blob after the click returns.
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Could not prepare the statement.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex items-center gap-3 flex-wrap mt-3">
            <button type="button" onClick={download} disabled={busy}
                className="h-10 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-[#0369a1] hover:bg-slate-50 disabled:opacity-60 flex items-center gap-1.5">
                {busy ? <Spinner size="sm" color="#03a9e7" label="Preparing…" /> : <><Download size={15} /> {periodLabel(period)} statement (PDF)</>}
            </button>
            {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
    )
}
