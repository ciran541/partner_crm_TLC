'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { RefreshCw, Lock, ArrowRight, Loader2 } from 'lucide-react'
import Modal from '@/components/shared/Modal'
import { revisitGate, buildRevisitCase } from '@/lib/insurance/revisit'
import { todaySgt } from '@/lib/insurance/promotions'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import type { Case } from '@/lib/types'

/**
 * "Revisit" on a Closed Won case — starts the client's next refinancing cycle
 * as a NEW linked case (the closed one is never reopened). Two safeguards:
 *   1. locked until the case's follow-up date (also enforced by the API)
 *   2. a confirmation showing exactly what will be created
 */

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export default function RevisitControl({ caseData, childId, casePath }: {
    caseData: Case
    childId: string | null
    /** Where a case lives, e.g. id => `/insurance/dashboard/cases/${id}` */
    casePath: (id: string) => string
}) {
    const router = useRouter()
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (caseData.stage !== 'Closed Won') return null

    if (childId) {
        return (
            <Link href={casePath(childId)} className="bg-white/10 border border-white/25 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-white/20 transition-colors inline-flex items-center gap-2">
                Open revisit case <ArrowRight size={14} />
            </Link>
        )
    }

    const gate = revisitGate(caseData, todaySgt(), null)
    if (!gate.ok) {
        const label = gate.reason === 'too_early' && gate.unlocksOn
            ? `Revisit opens ${fmt(gate.unlocksOn)}`
            : 'Set a follow-up date to schedule the revisit'
        return (
            <div className="text-right">
                <button type="button" disabled className="bg-white/10 border border-white/15 text-white/60 text-sm font-bold px-4 py-2 rounded-lg inline-flex items-center gap-2 cursor-not-allowed">
                    <Lock size={13} /> Revisit
                </button>
                <p className="text-[11px] text-white/60 mt-1">{label}</p>
            </div>
        )
    }

    const { estimate } = buildRevisitCase(caseData, todaySgt(), null)
    const name = caseData.client_name?.trim() || 'this client'

    async function revisit() {
        setBusy(true)
        setError(null)
        try {
            const res = await fetch(`/api/insurance/cases/${caseData.id}/revisit`, { method: 'POST' })
            const json = await res.json().catch(() => ({}))
            if (!res.ok || !json.id) { setError(json.error ?? 'Could not start the revisit.'); return }
            invalidateCaseData()
            router.push(casePath(json.id))
        } catch {
            setError('Network error — please try again.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <button type="button" onClick={() => setConfirming(true)}
                className="bg-white text-[#052d4a] text-sm font-bold px-4 py-2 rounded-lg hover:bg-sky-50 transition-colors inline-flex items-center gap-2">
                <RefreshCw size={14} /> Revisit client
            </button>

            {confirming && (
                <Modal title={`Revisit ${name}?`} onClose={() => !busy && setConfirming(false)}>
                    <div className="space-y-4 text-sm text-slate-600">
                        <p>
                            This starts a <b>new Refinancing case</b> for {name}, active straight away and counted in your potential revenue.
                        </p>
                        <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5 text-xs">
                            <Row label="Estimated outstanding loan" value={estimate.outstanding ? `≈ $${Math.round(estimate.outstanding).toLocaleString('en-SG')}` : 'To be filled in'} />
                            <Row label="Current bank" value={estimate.bank ?? 'To be filled in'} />
                            {estimate.lockInEnd && <Row label="Lock-in ended" value={fmt(estimate.lockInEnd)} />}
                        </div>
                        <p className="text-xs text-slate-500">
                            This closed case stays exactly as it is, including its commission. The two cases are linked, so the client&apos;s full history shows on both.
                        </p>
                        {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
                        <div className="flex justify-end gap-2 pt-1">
                            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="text-sm font-semibold text-slate-500 hover:text-slate-700 px-3 py-2">
                                Cancel
                            </button>
                            <button type="button" disabled={busy} onClick={revisit} className="btn-primary text-sm px-5 py-2 inline-flex items-center gap-2 disabled:opacity-50">
                                {busy && <Loader2 size={14} className="animate-spin" />} Yes, revisit
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    )
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold text-[#052d4a] tabular-nums">{value}</span>
        </div>
    )
}
