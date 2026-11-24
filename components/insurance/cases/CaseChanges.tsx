'use client'

import { useEffect, useState } from 'react'
import { PencilLine } from 'lucide-react'
import { caseFieldLabel, caseFieldValue } from '@/lib/insurance/caseFields'

export interface AdminEdit { reason?: string; fee?: number; mode?: string; changes?: Record<string, { from: unknown; to: unknown }> }

/** The changes in one admin edit: "Bank: DBS → UOB". */
export function ChangeList({ edit }: { edit: AdminEdit }) {
    return (
        <>
            {edit.mode === 'reopen' && <p>Sent back to the agent</p>}
            {Object.entries(edit.changes ?? {}).map(([k, v]) => (
                <p key={k} className="break-words"><span className="font-semibold">{caseFieldLabel(k)}:</span> <span className="text-slate-500">{caseFieldValue(v.from)}</span> → {caseFieldValue(v.to)}</p>
            ))}
            {!!edit.fee && <p className="text-red-600">${edit.fee} correction fee</p>}
            {edit.reason && <p className="italic">&ldquo;{edit.reason}&rdquo;</p>}
        </>
    )
}

/** Agent's case page: what TLC changed on this case. Renders nothing when there's nothing. */
export default function CaseChanges({ caseId }: { caseId: string }) {
    const [rows, setRows] = useState<{ id: string; created_at: string; new_value: AdminEdit }[]>([])
    useEffect(() => {
        let alive = true
        fetch(`/api/insurance/cases/${caseId}/changes`).then(r => (r.ok ? r.json() : { rows: [] })).then(d => { if (alive) setRows(d.rows ?? []) }).catch(() => {})
        return () => { alive = false }
    }, [caseId])
    if (!rows.length) return null
    return (
        <details className="card p-4">
            <summary className="cursor-pointer text-sm font-bold text-[#052d4a] flex items-center gap-2"><PencilLine size={15} className="text-[#03a9e7]" /> Changes made by TLC ({rows.length})</summary>
            <div className="mt-3 space-y-3">
                {rows.map(r => (
                    <div key={r.id} className="text-sm text-slate-700 border-t border-slate-100 pt-2">
                        <p className="text-xs text-slate-500">{new Date(r.created_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <ChangeList edit={r.new_value} />
                    </div>
                ))}
            </div>
        </details>
    )
}
