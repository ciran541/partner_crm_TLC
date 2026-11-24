'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import Skeleton from '@/components/shared/Skeleton'
import Modal from '@/components/shared/Modal'
import RefinancingWorkflowPanel from '@/components/insurance/workflow/RefinancingWorkflow'
import PurchaseWorkflowPanel from '@/components/insurance/workflow/PurchaseWorkflow'
import DecouplingWorkflowPanel from '@/components/insurance/workflow/DecouplingWorkflow'
import EquityLoanWorkflowPanel from '@/components/insurance/workflow/EquityLoanWorkflow'
import { ErrorBox, postJson } from '@/components/admin/ui'
import { workflowCaseFields, type AnyWorkflow } from '@/lib/insurance/workflowFields'
import { getDecoupleWorkflow, getEquityLoanWorkflow, getPurchaseWorkflow, getRefinancingWorkflow, type DecoupleWorkflow, type EquityLoanWorkflow, type PurchaseWorkflow, type RefinancingWorkflow } from '@/lib/types/workflow'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import type { Case } from '@/lib/types'

/**
 * Admin corrects workflow answers. The agent's own panels, but nothing autosaves:
 * changes are kept here until Save, with a reason the agent sees. No caseId or
 * client email is passed in, so nothing here can email the client.
 */
export default function AdminWorkflowPage() {
    const router = useRouter()
    const id = useParams()?.id as string
    const [c, setCase] = useState<Case | null>(null)
    const [wf, setWf] = useState<AnyWorkflow>({})
    const [dirty, setDirty] = useState(false)
    const [asking, setAsking] = useState(false)
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loadError, setLoadError] = useState(false)

    useEffect(() => {
        let alive = true
        supabase.from('cases').select('*').eq('id', id).single().then(({ data }) => {
            if (!alive) return
            if (!data) { setLoadError(true); return }
            const row = data as Case
            setCase(row)
            setWf(row.case_type === 'Purchase' ? getPurchaseWorkflow(row.workflow_data)
                : row.case_type === 'Decouple' ? getDecoupleWorkflow(row.workflow_data)
                    : row.case_type === 'Equity Loan' ? getEquityLoanWorkflow(row.workflow_data) : getRefinancingWorkflow(row.workflow_data))
        })
        return () => { alive = false }
    }, [id])

    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => e.preventDefault()
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    const back = `/admin/insurance/cases/${id}`
    const leave = () => { if (!dirty || window.confirm('Discard your changes?')) router.push(back) }
    const onChange = (next: AnyWorkflow) => { setWf(next); setDirty(true) }

    const save = async () => {
        if (!c) return
        setBusy(true); setError(null)
        try {
            await postJson(`/api/admin/insurance/cases/${id}`, { updated_at: c.updated_at, reason, changes: { workflow_data: wf, ...workflowCaseFields(c.case_type, wf) } }, 'PATCH')
            setDirty(false)
            invalidateCaseData()
            router.push(back)
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save'); setBusy(false) }
    }

    if (loadError) return <ErrorBox message="Case not found." />
    if (!c) return <Skeleton height={400} radius={14} />
    const common = { embedded: true, clientName: c.client_name, hasClientName: !!c.client_name?.trim(), onContinue: () => {} }
    return (
        <div className="space-y-5 pb-24">
            <button type="button" onClick={leave} className="min-h-[44px] flex items-center gap-1.5 text-sm text-slate-500"><ArrowLeft size={15} /> Back to case</button>
            <h1 className="ios-page-title">Edit workflow · {c.client_name || 'Unnamed'}</h1>
            {c.case_type === 'Purchase' ? <PurchaseWorkflowPanel {...common} data={wf as PurchaseWorkflow} onChange={onChange} />
                : c.case_type === 'Decouple' ? <DecouplingWorkflowPanel {...common} data={wf as DecoupleWorkflow} onChange={onChange} />
                    : c.case_type === 'Equity Loan' ? <EquityLoanWorkflowPanel {...common} data={wf as EquityLoanWorkflow} onChange={onChange} />
                        : <RefinancingWorkflowPanel {...common} data={wf as RefinancingWorkflow} onChange={onChange} currentStage={c.stage} followUpDate={c.follow_up_date} />}
            {dirty && (
                <div className="sticky bottom-4 z-30 card p-3 shadow-xl flex items-center gap-3">
                    <p className="flex-1 text-sm text-slate-600">Not saved yet.</p>
                    <button type="button" onClick={leave} className="min-h-[44px] px-4 text-sm font-semibold text-slate-500">Discard</button>
                    <button type="button" onClick={() => setAsking(true)} className="min-h-[44px] px-5 rounded-xl bg-[#052d4a] text-white text-sm font-bold">Save changes</button>
                </div>
            )}
            {asking && (
                <Modal title="Save changes" onClose={() => { if (!busy) setAsking(false) }}>
                    <label className="block text-sm font-semibold text-slate-700">Reason (the agent sees this)
                        <textarea rows={3} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} className="w-full mt-1 border border-slate-200 rounded-lg p-3 font-normal" />
                    </label>
                    {error && <p role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
                    <button type="button" disabled={busy || !reason.trim()} onClick={save} className="mt-4 w-full min-h-[44px] rounded-xl bg-[#052d4a] text-white text-sm font-bold disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
                </Modal>
            )}
        </div>
    )
}
