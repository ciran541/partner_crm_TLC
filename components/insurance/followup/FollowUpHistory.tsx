'use client'

import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { stageBadge, stageLabel } from '@/lib/insurance/stages'

interface Entry {
    id: string
    follow_up_date: string | null
    remark: string | null
    stage: string
    no_follow_up: boolean
    created_at: string
    profiles?: { name?: string | null } | null
}

const fmt = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * A case's follow-up history, newest first — the client's story in follow-ups
 * ("Pending Docs · 26 Nov 2026 · Obtain Documents"). Rows are written by a DB
 * trigger on every follow-up change (migration 20261123000000), so nothing a
 * screen does can skip one. `refreshKey` reloads it after a save.
 */
export default function FollowUpHistory({ caseId, refreshKey }: { caseId: string; refreshKey?: unknown }) {
    const [rows, setRows] = useState<Entry[] | null>(null)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        let alive = true
        fetch(`/api/insurance/cases/${caseId}/followup`)
            .then(r => r.json())
            .then(d => { if (alive) setRows(d.history ?? []) })
            .catch(() => { if (alive) setRows([]) })
        return () => { alive = false }
    }, [caseId, refreshKey])

    if (!rows || rows.length === 0) return null
    const shown = open ? rows : rows.slice(0, 3)

    return (
        <div className="pt-4 mt-4 border-t border-slate-100">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2.5 flex items-center gap-1.5">
                <History size={12} /> Follow-up history ({rows.length})
            </p>
            <ol className="space-y-2.5">
                {shown.map(r => {
                    const badge = stageBadge(r.stage)
                    return (
                        <li key={r.id} className="flex gap-3 text-sm">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 shrink-0" />
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-slate-800">
                                        {r.no_follow_up ? 'Stopped following up' : r.follow_up_date ? fmt(r.follow_up_date) : 'Follow-up cleared'}
                                    </span>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.text }}>{stageLabel(r.stage)}</span>
                                </div>
                                {r.remark && <p className="text-slate-600">{r.remark}</p>}
                                <p className="text-[11px] text-slate-400">
                                    Set {new Date(r.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    {r.profiles?.name ? ` by ${r.profiles.name}` : ''}
                                </p>
                            </div>
                        </li>
                    )
                })}
            </ol>
            {rows.length > 3 && (
                <button type="button" onClick={() => setOpen(o => !o)} className="mt-2 text-xs font-semibold text-[#03a9e7]">
                    {open ? 'Show less' : `Show all ${rows.length}`}
                </button>
            )}
        </div>
    )
}
