'use client'

import React, { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Case, ReferredBanker } from '@/lib/types'
import { RefinancingWorkflow as RefinancingWorkflowData, getRefinancingWorkflow, PurchaseWorkflow, getPurchaseWorkflow, DecoupleWorkflow, getDecoupleWorkflow, EquityLoanWorkflow, getEquityLoanWorkflow } from '@/lib/types/workflow'
import RefinancingWorkflowPanel from '@/components/insurance/workflow/RefinancingWorkflow'
import PurchaseWorkflowPanel from '@/components/insurance/workflow/PurchaseWorkflow'
import DecouplingWorkflowPanel from '@/components/insurance/workflow/DecouplingWorkflow'
import EquityLoanWorkflowPanel from '@/components/insurance/workflow/EquityLoanWorkflow'
import PurchaseOverview from '@/components/insurance/workflow/PurchaseOverview'
import RefiOverview from '@/components/insurance/workflow/RefiOverview'
import DecoupleOverview from '@/components/insurance/workflow/DecoupleOverview'
import EquityLoanOverview from '@/components/insurance/workflow/EquityLoanOverview'
import { computePurchase, inputsFromWorkflow } from '@/lib/insurance/purchaseCalc'
import BankerMultiSelect from '@/components/insurance/BankerMultiSelect'
import RateScheduleEditor from '@/components/insurance/RateScheduleEditor'
import { loanSpecsFor, prefillLoan, closedWonTotals, packageSummary, CLOSED_LOAN_LABELS } from '@/lib/insurance/closedWon'
import { calculateCommission } from '@/lib/property/commission'
import type { CaseType, ClosedWonData, ClosedWonLoan, ClosedLoanKind } from '@/lib/types'
import type { RateScheduleEntry } from '@/lib/types/rates'
import type { SoraRates } from '@/lib/insurance/sora'
// Type-only — importing a runtime value from extractLoanOffer would pull its
// pdf-parse dynamic import into the client bundle.
import type { ExtractedLo } from '@/lib/insurance/extractLoanOffer'
import {
    Save, Edit2, X, User, Home, Pencil,
    Briefcase, CheckCircle2, AlertTriangle, CalendarClock,
    Upload, Trash2, FileText, TrendingUp, ArrowLeft, Sparkles, Loader2
} from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import Skeleton from '@/components/shared/Skeleton'
import { invalidateCaseData } from '@/lib/insurance/caseCache'
import { PIPELINE_STAGES, INACTIVE_STAGE, OPEN_STAGES } from '@/lib/insurance/stages'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import RevisitControl from '@/components/insurance/cases/RevisitControl'
import CaseJourney from '@/components/insurance/cases/CaseJourney'
import { todaySgt } from '@/lib/insurance/promotions'
import { CORRECTION_FEE, commissionWithFee } from '@/lib/insurance/commission'
import CorrectionNotice from '@/components/insurance/cases/CorrectionNotice'

type TabKey = 'overview' | 'workflow'

// Progress dots show the live pipeline only — Inactive sits before it, Closed Lost beside it.
const PROGRESS_STAGES = PIPELINE_STAGES.filter(s => s !== INACTIVE_STAGE && s !== 'Closed Lost')

const CLOSED_LOST_REASONS = [
    'Client chose another bank directly',
    'Client used another broker',
    'Rate not competitive enough',
    'Client decided not to refinance',
    'Client selling property',
    'Loan not approved',
    'Client unresponsive / lost contact',
    'Other',
]

export default function CaseDetailPage() {
    return (
        <Suspense fallback={<Skeleton height={320} radius={14} />}>
            <CaseDetailContent />
        </Suspense>
    )
}

function CaseDetailContent() {
    const router = useRouter()
    const params = useParams()
    const caseId = params?.id as string
    // Router-aware search params — reliable during App Router client navigation
    // (window.location can still hold the previous URL on the first render).
    const searchParams = useSearchParams()
    const initialTab = ((): TabKey => {
        const tab = searchParams.get('tab')
        return tab === 'workflow' ? 'workflow' : 'overview'
    })()

    const [caseData, setCaseData] = useState<Case | null>(null)
    // The follow-on case created by Revisit, if any (one per case — unique index).
    const [revisitChildId, setRevisitChildId] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [userRole, setUserRole] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    // Workflow state (shape depends on case_type)
    const [workflowData, setWorkflowData] = useState<RefinancingWorkflowData | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow>({})
    const [workflowSaving, setWorkflowSaving] = useState(false)
    const [workflowSaved, setWorkflowSaved] = useState(false)
    const [followUpSaving, setFollowUpSaving] = useState(false)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Always-current case type — extractCaseFields runs inside a memoized callback
    // whose caseData closure can be stale, which would mis-route the column sync.
    const caseTypeRef = useRef<string | undefined>(undefined)

    // Overview's client-details block — the workflow hand-off scrolls here and
    // focuses the name field instead of dumping the agent at a random position.
    const clientSectionRef = useRef<HTMLDivElement>(null)
    const wantScrollToClientRef = useRef(false)

    // Inline case-name editing in the page header
    const [nameEditing, setNameEditing] = useState(false)
    const [nameValue, setNameValue] = useState('')
    const [nameSaving, setNameSaving] = useState(false)
    const nameInputRef = useRef<HTMLInputElement>(null)

    // Closed Won modal
    const [closedWonOpen, setClosedWonOpen] = useState(false)
    // Closed Lost modal
    const [closedLostOpen, setClosedLostOpen] = useState(false)
    // Pending Docs banker-selection modal
    const [pendingDocsOpen, setPendingDocsOpen] = useState(false)

    useEffect(() => {
        if (caseId) loadCase()
    }, [caseId])

    // Scroll on tab switch: the workflow hand-off jumps straight to the client
    // form and focuses its first field; any other switch returns to the top so
    // you never land mid-page. DOM-only — no state writes inside the effect.
    useEffect(() => {
        if (activeTab === 'overview' && wantScrollToClientRef.current) {
            wantScrollToClientRef.current = false
            requestAnimationFrame(() => {
                const section = clientSectionRef.current
                section?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                const firstInput = section?.querySelector('input') as HTMLInputElement | null
                firstInput?.focus({ preventScroll: true })
            })
        } else {
            window.scrollTo({ top: 0 })
        }
    }, [activeTab])

    const loadCase = async () => {
        setLoading(true)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/insurance/login'); return }

        const { data: profile } = await supabase
            .from('profiles').select('role').eq('id', user.id).single()
        setUserRole(profile?.role ?? null)

        const { data, error } = await supabase
            .from('cases').select('*').eq('id', caseId).single()
        const { data: child } = await supabase
            .from('cases').select('id').eq('parent_case_id', caseId).maybeSingle()
        setRevisitChildId(child?.id ?? null)

        if (error || !data) {
            router.push('/insurance/dashboard/cases')
        } else {
            caseTypeRef.current = data.case_type
            setCaseData(data)
            setNameValue(data.client_name ?? '')
            setWorkflowData(
                data.case_type === 'Purchase'
                    ? getPurchaseWorkflow(data.workflow_data)
                    : data.case_type === 'Decouple'
                        ? getDecoupleWorkflow(data.workflow_data)
                        : data.case_type === 'Equity Loan'
                            ? getEquityLoanWorkflow(data.workflow_data)
                            : getRefinancingWorkflow(data.workflow_data)
            )
        }
        setLoading(false)
    }

    // Single admin-aware persist path. Admins/super_admins must go through the
    // admin API (RLS blocks their direct table writes); agents update directly.
    // Returns an error string, or null on success.
    const persistCaseUpdate = useCallback(async (updates: Record<string, unknown>): Promise<string | null> => {
        const isAdminUser = userRole === 'admin' || userRole === 'super_admin'
        const payload = { ...updates, updated_at: new Date().toISOString() }
        if (isAdminUser) {
            const res = await fetch('/api/admin/update-case', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: caseId, updates: payload }),
            })
            if (!res.ok) { const d = await res.json().catch(() => ({})); return d.error || 'Failed to save' }
            return null
        }
        const { error } = await supabase.from('cases').update(payload).eq('id', caseId)
        return error?.message ?? null
    }, [caseId, userRole])

    const handleUpdate = async (updates: Partial<Case>) => {
        if (!caseData) return
        setSaving(true)
        setAlert(null)
        const err = await persistCaseUpdate(updates)
        setSaving(false)
        if (err) {
            setAlert({ type: 'error', message: err })
        } else {
            await loadCase()
            invalidateCaseData() // keep dashboard / cases-list cache in sync
            setIsEditing(false)
            setAlert({ type: 'success', message: 'Case updated successfully.' })
        }
    }

    // Extract case-column values from workflow data so Overview stays in sync
    const extractCaseFields = (wf: RefinancingWorkflowData | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow): Partial<Case> => {
        const updates: Partial<Case> = {}

        if (caseTypeRef.current === 'Purchase') {
            const p = wf as PurchaseWorkflow
            if (p.property_type) {
                const map: Record<string, string> = {
                    resale_condo: 'Private Condo', new_launch_condo: 'Private Condo', resale_landed: 'Landed',
                    ec_new_launch: 'EC (Executive Condo)', resale_hdb: 'HDB', bto: 'HDB',
                }
                updates.property_type = map[p.property_type] ?? p.property_type
            }
            if (p.property_price) updates.property_price = p.property_price
            // Sync overview "Loan Amount" with the computed final loan of the headline option.
            const loan = computePurchase(inputsFromWorkflow(p)).options[0]?.finalLoan
            if (loan && loan > 0) updates.loan_size = Math.floor(loan)
            return updates
        }

        if (caseTypeRef.current === 'Decouple') {
            const d = wf as DecoupleWorkflow
            if (d.current_bank) updates.current_bank = d.current_bank
            if (d.property_valuation) updates.property_price = d.property_valuation
            const totalOutstanding = (d.outstanding_home_loan ?? 0) + (d.outstanding_equity_loan ?? 0) + (d.outstanding_undisbursed ?? 0)
            if (totalOutstanding > 0) updates.existing_loan_amount = totalOutstanding
            if (d.property_type) {
                const map: Record<string, string> = {
                    completed_condo: 'Private Condo', completed_ec: 'Private Condo', incompleted_condo: 'Private Condo', landed: 'Landed',
                }
                updates.property_type = map[d.property_type] ?? d.property_type
            }
            return updates
        }

        if (caseTypeRef.current === 'Equity Loan') {
            const e = wf as EquityLoanWorkflow
            if (e.current_bank) updates.current_bank = e.current_bank
            if (e.market_price) updates.property_price = e.market_price
            const totalOutstanding = (e.outstanding_disbursed ?? 0) + (e.outstanding_equity_loan ?? 0)
            if (totalOutstanding > 0) updates.existing_loan_amount = totalOutstanding
            if (e.equity_loan_amount) updates.loan_size = e.equity_loan_amount
            if (e.property_type) {
                const map: Record<string, string> = {
                    landed: 'Landed', completed_condo: 'Private Condo', completed_ec_mop: 'Private Condo',
                }
                updates.property_type = map[e.property_type] ?? e.property_type
            }
            return updates
        }

        const r = wf as RefinancingWorkflowData

        if (r.current_bank) updates.current_bank = r.current_bank
        const totalOutstanding = (r.outstanding_disbursed ?? 0) + (r.outstanding_undisbursed ?? 0)
        if (totalOutstanding > 0) updates.existing_loan_amount = totalOutstanding
        if (r.lockin_end_date) updates.lock_in_end_date = r.lockin_end_date
        if (r.market_price) updates.property_price = r.market_price
        if (r.property_type) {
            const map: Record<string, string> = {
                hdb: 'HDB', completed_condo_ec: 'Private Condo', incompleted_condo_ec: 'Private Condo', landed: 'Landed',
            }
            updates.property_type = map[r.property_type] ?? r.property_type
        }

        return updates
    }

    const saveWorkflow = useCallback(async (wf: RefinancingWorkflowData | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow) => {
        setWorkflowSaving(true)
        setWorkflowSaved(false)
        const caseFields = extractCaseFields(wf)
        const err = await persistCaseUpdate({ workflow_data: wf, ...caseFields })
        setWorkflowSaving(false)
        if (!err) { setWorkflowSaved(true); setTimeout(() => setWorkflowSaved(false), 2000) }
        else setAlert({ type: 'error', message: `Workflow save failed: ${err}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistCaseUpdate])

    const handleWorkflowChange = useCallback((updated: RefinancingWorkflowData | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow) => {
        setWorkflowData(updated)
        // Immediately update caseData state so Overview reflects workflow changes without waiting for DB save
        const caseFields = extractCaseFields(updated)
        if (Object.keys(caseFields).length > 0) {
            setCaseData(prev => prev ? { ...prev, ...caseFields } : prev)
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => saveWorkflow(updated), 800)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saveWorkflow])

    const handleFieldChange = (field: keyof Case, value: any) => {
        if (!caseData) return
        setCaseData({ ...caseData, [field]: value })
    }

    const handleStageChange = (newStage: string) => {
        if (!caseData) return
        if (newStage === 'Closed Won') { setClosedWonOpen(true); return }
        if (newStage === 'Closed Lost') { setClosedLostOpen(true); return }
        // Moving to Pending Docs prompts the agent to record which banker(s) the case was referred to.
        if (newStage === 'Pending Docs') { setPendingDocsOpen(true); return }
        handleFieldChange('stage', newStage)
    }

    // Assign/remove referred bankers — auto-saves immediately (no edit mode), like follow-up.
    const handleSetBankers = useCallback(async (bankers: ReferredBanker[]) => {
        setCaseData(prev => prev ? { ...prev, referred_bankers: bankers } : prev)
        const err = await persistCaseUpdate({ referred_bankers: bankers })
        if (err) setAlert({ type: 'error', message: `Banker save failed: ${err}` })
        else invalidateCaseData()
    }, [persistCaseUpdate])

    // Set a follow-up reminder date — routed through the API so it also syncs to
    // the agent's Google Calendar (non-blocking) and the Follow-Up tab.
    // followUpSavingRef guards against a double-click firing two concurrent
    // PATCHes — each triggers its own calendar sync, and two racing syncs for
    // the same case is exactly what produced duplicate/broken calendar rows
    // (see migration 20260807000000). A ref (not just the state var) is used
    // for the check so it's read synchronously, not subject to a stale closure
    // from an in-flight re-render.
    const followUpSavingRef = useRef(false)
    const handleSetFollowUp = useCallback(async (date: string) => {
        if (followUpSavingRef.current) return
        followUpSavingRef.current = true
        setFollowUpSaving(true)
        setCaseData(prev => prev ? { ...prev, follow_up_date: date } : prev)
        try {
            const res = await fetch(`/api/insurance/cases/${caseId}/followup`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ follow_up_date: date }),
            })
            if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Failed to save') }
            invalidateCaseData()
            setAlert({ type: 'success', message: 'Follow-up reminder set.' })
        } catch (e) {
            setAlert({ type: 'error', message: `Follow-up save failed: ${e instanceof Error ? e.message : ''}` })
        } finally {
            followUpSavingRef.current = false
            setFollowUpSaving(false)
        }
    }, [caseId])

    const commitNameEdit = useCallback(async () => {
        const trimmed = nameValue.trim()
        setNameEditing(false)
        if (trimmed === (caseData?.client_name ?? '')) return
        setNameSaving(true)
        const err = await persistCaseUpdate({ client_name: trimmed || undefined })
        setNameSaving(false)
        if (err) {
            setAlert({ type: 'error', message: `Name save failed: ${err}` })
            setNameValue(caseData?.client_name ?? '')
        } else {
            setCaseData(prev => prev ? { ...prev, client_name: trimmed || undefined } : prev)
            invalidateCaseData()
        }
    }, [nameValue, caseData, persistCaseUpdate])

    const handleSave = () => {
        if (!caseData) return
        handleUpdate({
            stage: caseData.stage,
            client_name: caseData.client_name,
            client_mobile: caseData.client_mobile,
            client_email: caseData.client_email,
            loan_size: caseData.loan_size,
            property_type: caseData.property_type,
            property_price: caseData.property_price,
            current_bank: caseData.current_bank,
            existing_loan_amount: caseData.existing_loan_amount,
            lock_in_end_date: caseData.lock_in_end_date,
            property_address: caseData.property_address,
            subsidy_provided: caseData.subsidy_provided,
            remarks: caseData.remarks,
            referred_bankers: caseData.referred_bankers ?? [],
        })
    }

    // Inactive → live pipeline in one tap. Saves immediately, like follow-up.
    const handleActivate = async () => {
        if (!caseData) return
        const next = OPEN_STAGES[0]
        setCaseData({ ...caseData, stage: next })
        const err = await persistCaseUpdate({ stage: next })
        if (err) {
            setCaseData({ ...caseData })
            setAlert({ type: 'error', message: `Could not activate: ${err}` })
        } else {
            invalidateCaseData()
            setAlert({ type: 'success', message: `Moved to ${next} — it's now in your active cases.` })
        }
    }

    // Admin-only: mark this closed case's commission as paid / unpaid.
    const handleToggleCommissionPaid = async () => {
        if (!caseData) return
        const next = caseData.commission_status === 'paid' ? 'unpaid' : 'paid'
        setCaseData({ ...caseData, commission_status: next })
        const err = await persistCaseUpdate({ commission_status: next })
        if (err) setAlert({ type: 'error', message: `Failed to update commission: ${err}` })
        else invalidateCaseData()
    }

    if (loading) return (
        <div className="max-w-4xl mx-auto" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Skeleton height={18} width={130} radius={6} />
            <Skeleton height={36} width={260} radius={8} />
            <Skeleton height={92} radius={14} />
            <Skeleton height={42} width={300} radius={12} />
            <Skeleton height={220} radius={14} />
        </div>
    )
    if (!caseData) return null

    const isClosedWon = caseData.stage === 'Closed Won'
    const isClosedLost = caseData.stage === 'Closed Lost'
    const isClosed = isClosedWon || isClosedLost
    const isAdminUser = userRole === 'admin' || userRole === 'super_admin'

    const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
        { key: 'overview', label: 'Overview', icon: User },
        { key: 'workflow', label: 'Workflow', icon: Briefcase },
    ]

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            {/* Back + Header */}
            <div>
                <button
                    type="button"
                    onClick={() => router.push('/insurance/dashboard')}
                    className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-[#03a9e7] transition-colors mb-3"
                >
                    <ArrowLeft size={15} />
                    Back
                </button>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            {nameEditing ? (
                                <input
                                    ref={nameInputRef}
                                    value={nameValue}
                                    onChange={e => setNameValue(e.target.value)}
                                    onBlur={commitNameEdit}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') { e.currentTarget.blur() }
                                        if (e.key === 'Escape') { setNameValue(caseData.client_name ?? ''); setNameEditing(false) }
                                    }}
                                    placeholder="Client name…"
                                    className="ios-page-title bg-transparent border-b-2 border-[#03a9e7] outline-none min-w-[180px] max-w-xs"
                                    style={{ lineHeight: 'inherit', padding: '0 2px' }}
                                />
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { setNameEditing(true); setTimeout(() => nameInputRef.current?.focus(), 0) }}
                                    className="group flex items-center gap-2 hover:opacity-80 transition-opacity"
                                    title="Click to rename"
                                >
                                    <h1 className={`ios-page-title ${!caseData.client_name ? 'text-slate-400 italic' : ''}`}>
                                        {nameSaving ? 'Saving…' : (caseData.client_name || 'Unnamed Case')}
                                    </h1>
                                    <Pencil size={14} className="text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                                </button>
                            )}
                            <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-100">
                                {caseData.case_type}
                            </span>
                            {isClosedWon && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <CheckCircle2 size={11} /> Closed Won
                                </span>
                            )}
                            {isClosedLost && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                                    <X size={11} /> Closed Lost
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-slate-400 mt-1">
                            Created {new Date(caseData.created_at).toLocaleDateString()}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {isEditing ? (
                            <>
                                <button onClick={() => { setIsEditing(false); loadCase() }} className="btn-ghost text-sm px-4 py-2 flex items-center gap-1.5">
                                    <X size={15} /> Cancel
                                </button>
                                <button onClick={handleSave} disabled={saving} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
                                    {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Save size={15} /> Save</>}
                                </button>
                            </>
                        ) : (
                            <>
                                {!isClosed && activeTab !== 'workflow' && (
                                    <button onClick={() => setIsEditing(true)} className="btn-primary text-sm px-4 py-2 flex items-center gap-2">
                                        <Edit2 size={15} /> Edit
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {alert && (
                <InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} />
            )}

            {/* TLC corrected this submission — why, by whom, and any fee (internal; not on the Workflow tab) */}
            {activeTab !== 'workflow' && <CorrectionNotice data={caseData} />}

            {/* Stage Bar — internal/pipeline; hidden on the client-facing Workflow tab */}
            {activeTab !== 'workflow' && (
            <div className="card p-5" style={{ background: 'linear-gradient(to right, #052d4a, #0f4a75)', color: 'white' }}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <p className="text-[11px] uppercase tracking-widest font-semibold opacity-70 mb-1">Current Stage</p>
                        {isEditing ? (
                            <select
                                value={caseData.stage}
                                onChange={e => handleStageChange(e.target.value)}
                                className="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-2 text-sm font-semibold outline-none"
                            >
                                {PIPELINE_STAGES.map(s => (
                                    <option key={s} value={s} className="text-black">{s}</option>
                                ))}
                            </select>
                        ) : (
                            <p className="text-xl font-bold">{caseData.stage}</p>
                        )}
                        {caseData.stage === INACTIVE_STAGE && (
                            <p className="text-[11px] opacity-70 mt-1">Parked for follow-up — not in your active cases or revenue.</p>
                        )}
                    </div>
                    {caseData.stage === INACTIVE_STAGE && !isEditing && (
                        <button
                            type="button"
                            onClick={handleActivate}
                            className="bg-white text-[#052d4a] text-sm font-bold px-4 py-2 rounded-lg hover:bg-sky-50 transition-colors"
                        >
                            Make active
                        </button>
                    )}
                    {caseData.stage === 'Closed Won' && !isEditing && (
                        <RevisitControl
                            caseData={caseData}
                            childId={revisitChildId}
                            casePath={id => `/insurance/dashboard/cases/${id}`}
                        />
                    )}
                    {/* Stage progress dots */}
                    {caseData.stage !== INACTIVE_STAGE && (
                    <div className="hidden md:flex items-center gap-1.5">
                        {PROGRESS_STAGES.map((s, i) => {
                            const stageIndex = PROGRESS_STAGES.indexOf(caseData.stage)
                            const thisIndex = PROGRESS_STAGES.indexOf(s)
                            const isActive = s === caseData.stage
                            const isPast = thisIndex < stageIndex && !isClosed
                            return (
                                <div key={s} className="flex items-center gap-1.5">
                                    <div className={`w-2 h-2 rounded-full transition-all ${
                                        isActive ? 'bg-white w-3 h-3' :
                                        isPast ? 'bg-white/60' : 'bg-white/25'
                                    }`} title={s} />
                                    {i < PROGRESS_STAGES.length - 1 && (
                                        <div className={`w-5 h-px ${isPast ? 'bg-white/60' : 'bg-white/20'}`} />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    )}
                </div>
            </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-full sm:w-auto self-start">
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                            activeTab === tab.key
                                ? 'bg-white text-[#052d4a] shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <tab.icon size={15} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab: Overview */}
            {activeTab === 'overview' && (
                <div className="space-y-5">
                    <CaseJourney
                        key={`${caseId}:${revisitChildId ?? ''}`}
                        caseId={caseId}
                        parentId={caseData.parent_case_id}
                        hrefFor={id => `/insurance/dashboard/cases/${id}`}
                    />
                    {/* Closed-Won summary — loans, commission, and next-cycle income projection */}
                    {isClosedWon && caseData.closed_won_data?.loans?.length ? (
                        <ClosedWonSummaryCard data={caseData} isAdmin={isAdminUser} onTogglePaid={handleToggleCommissionPaid} />
                    ) : null}

                    {/* Deal summary leads the tab — it's the natural "overview". */}
                    {caseData.case_type === 'Purchase' ? (
                        <PurchaseOverview
                            workflow={workflowData as PurchaseWorkflow}
                            stage={caseData.stage}
                            followUpDate={caseData.follow_up_date}
                            onOpenWorkflow={() => setActiveTab('workflow')}
                        />
                    ) : caseData.case_type === 'Decouple' ? (
                        <DecoupleOverview
                            workflow={workflowData as DecoupleWorkflow}
                            stage={caseData.stage}
                            followUpDate={caseData.follow_up_date}
                            onOpenWorkflow={() => setActiveTab('workflow')}
                        />
                    ) : caseData.case_type === 'Equity Loan' ? (
                        <EquityLoanOverview
                            workflow={workflowData as EquityLoanWorkflow}
                            stage={caseData.stage}
                            followUpDate={caseData.follow_up_date}
                            onOpenWorkflow={() => setActiveTab('workflow')}
                        />
                    ) : (
                        <RefiOverview
                            workflow={workflowData as RefinancingWorkflowData}
                            stage={caseData.stage}
                            followUpDate={caseData.follow_up_date}
                            onOpenWorkflow={() => setActiveTab('workflow')}
                        />
                    )}

                    {/* Client + follow-up — internal CRM fields, grouped at the bottom.
                        scroll-mt keeps a little breathing room when the hand-off jumps here. */}
                    <div ref={clientSectionRef} className="space-y-5 scroll-mt-20">
                        <SectionCard title="Client Information" icon={User}>
                            <GridField label="Name" isEditing={isEditing}>
                                <input type="text" value={caseData.client_name || ''} onChange={e => handleFieldChange('client_name', e.target.value)} placeholder="e.g. John Tan" className="input-std" />
                                {caseData.client_name || <span className="text-slate-400">—</span>}
                            </GridField>
                            <GridField label="Mobile" isEditing={isEditing}>
                                <input type="tel" value={caseData.client_mobile || ''} onChange={e => handleFieldChange('client_mobile', e.target.value)} placeholder="+65 9123 4567" className="input-std" />
                                {caseData.client_mobile || <span className="text-slate-400">—</span>}
                            </GridField>
                            <GridField label="Email" isEditing={isEditing}>
                                <input type="email" value={caseData.client_email || ''} onChange={e => handleFieldChange('client_email', e.target.value)} placeholder="client@email.com" className="input-std" />
                                {caseData.client_email || <span className="text-slate-400">—</span>}
                            </GridField>
                            <GridField label="Property Address" isEditing={isEditing}>
                                <input type="text" value={caseData.property_address || ''} onChange={e => handleFieldChange('property_address', e.target.value)} placeholder="optional" className="input-std" />
                                {caseData.property_address || <span className="text-slate-400">—</span>}
                            </GridField>
                            <GridField label="Subsidy Received" isEditing={isEditing}>
                                <input type="text" value={caseData.subsidy_provided || ''} onChange={e => handleFieldChange('subsidy_provided', e.target.value)} placeholder="e.g. $2,000" className="input-std" />
                                {caseData.subsidy_provided || <span className="text-slate-400">—</span>}
                            </GridField>
                            <GridField label="Remarks" isEditing={isEditing}>
                                <textarea rows={2} value={caseData.remarks || ''} onChange={e => handleFieldChange('remarks', e.target.value)} placeholder="optional" className="input-std" style={{ fontFamily: 'inherit', resize: 'vertical' }} />
                                {caseData.remarks ? <span className="whitespace-pre-wrap">{caseData.remarks}</span> : <span className="text-slate-400">—</span>}
                            </GridField>
                        </SectionCard>

                        {/* Referred bankers — internal CRM, auto-saves on change (no edit mode needed) */}
                        <BankerControl value={caseData.referred_bankers ?? []} onSave={handleSetBankers} />

                        {/* Follow-up reminder — internal CRM, never on the client-facing workflow */}
                        <FollowUpControl value={caseData.follow_up_date} onSave={handleSetFollowUp} saving={followUpSaving} />
                    </div>
                </div>
            )}

            {/* Tab: Workflow */}
            {activeTab === 'workflow' && (
                caseData.case_type === 'Refinancing' ? (
                    <RefinancingWorkflowPanel
                        data={workflowData as RefinancingWorkflowData}
                        onChange={handleWorkflowChange}
                        clientName={caseData.client_name}
                        clientEmail={caseData.client_email}
                        caseId={caseId}
                        embedded
                        saving={workflowSaving}
                        saved={workflowSaved}
                        currentStage={caseData.stage}
                        onStageAdvance={handleStageChange}
                        onSetFollowUp={handleSetFollowUp}
                        followUpDate={caseData.follow_up_date}
                        hasClientName={!!caseData.client_name?.trim()}
                        onContinue={() => {
                            if (!caseData.client_name?.trim()) {
                                wantScrollToClientRef.current = true
                                setIsEditing(true)
                            }
                            setActiveTab('overview')
                        }}
                    />
                ) : caseData.case_type === 'Purchase' ? (
                    <PurchaseWorkflowPanel
                        data={workflowData as PurchaseWorkflow}
                        onChange={handleWorkflowChange}
                        clientName={caseData.client_name}
                        clientEmail={caseData.client_email}
                        caseId={caseId}
                        embedded
                        saving={workflowSaving}
                        saved={workflowSaved}
                        hasClientName={!!caseData.client_name?.trim()}
                        onContinue={() => {
                            if (!caseData.client_name?.trim()) {
                                wantScrollToClientRef.current = true
                                setIsEditing(true)
                            }
                            setActiveTab('overview')
                        }}
                    />
                ) : caseData.case_type === 'Decouple' ? (
                    <DecouplingWorkflowPanel
                        data={workflowData as DecoupleWorkflow}
                        onChange={handleWorkflowChange}
                        clientName={caseData.client_name}
                        clientEmail={caseData.client_email}
                        caseId={caseId}
                        embedded
                        saving={workflowSaving}
                        saved={workflowSaved}
                        hasClientName={!!caseData.client_name?.trim()}
                        onContinue={() => {
                            if (!caseData.client_name?.trim()) {
                                wantScrollToClientRef.current = true
                                setIsEditing(true)
                            }
                            setActiveTab('overview')
                        }}
                    />
                ) : caseData.case_type === 'Equity Loan' ? (
                    <EquityLoanWorkflowPanel
                        data={workflowData as EquityLoanWorkflow}
                        onChange={handleWorkflowChange}
                        clientName={caseData.client_name}
                        clientEmail={caseData.client_email}
                        caseId={caseId}
                        embedded
                        saving={workflowSaving}
                        saved={workflowSaved}
                        hasClientName={!!caseData.client_name?.trim()}
                        onContinue={() => {
                            if (!caseData.client_name?.trim()) {
                                wantScrollToClientRef.current = true
                                setIsEditing(true)
                            }
                            setActiveTab('overview')
                        }}
                    />
                ) : (
                    <div className="card p-8 text-center space-y-3">
                        <p className="text-3xl">🚧</p>
                        <p className="font-semibold text-slate-700">Workflow coming soon</p>
                        <p className="text-sm text-slate-500">The guided workflow for <strong>{caseData.case_type}</strong> cases is under development.</p>
                    </div>
                )
            )}

            {/* Closed Won Modal */}
            {closedWonOpen && (
                <ClosedWonModal
                    initialData={caseData}
                    caseId={caseId}
                    onConfirm={async details => {
                        const error = await persistCaseUpdate({ ...details, stage: 'Closed Won' })
                        if (error) throw new Error(error)
                        await loadCase()
                        invalidateCaseData()
                        setIsEditing(false)
                        setClosedWonOpen(false)
                        // Sync the follow-up to Google Calendar (non-blocking).
                        if (details.follow_up_date) {
                            fetch(`/api/insurance/cases/${caseId}/followup`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ follow_up_date: details.follow_up_date }),
                            }).catch(() => {})
                        }
                    }}
                    onCancel={() => setClosedWonOpen(false)}
                />
            )}

            {/* Closed Lost Modal */}
            {closedLostOpen && (
                <ClosedLostModal
                    onConfirm={(reason, notes) => {
                        setClosedLostOpen(false)
                        handleUpdate({ stage: 'Closed Lost', closed_lost_reason: reason, closed_lost_notes: notes || undefined })
                    }}
                    onCancel={() => setClosedLostOpen(false)}
                />
            )}

            {/* Pending Docs — record banker(s) before advancing */}
            {pendingDocsOpen && (
                <PendingDocsModal
                    initialBankers={caseData.referred_bankers ?? []}
                    onConfirm={bankers => {
                        setPendingDocsOpen(false)
                        handleUpdate({ stage: 'Pending Docs', referred_bankers: bankers })
                    }}
                    onCancel={() => setPendingDocsOpen(false)}
                />
            )}

            <style jsx global>{`
                .input-std {
                    width: 100%;
                    padding: 8px 12px;
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    font-size: 14px;
                    color: #0f172a;
                    background: white;
                    outline: none;
                    transition: border-color 0.15s;
                }
                .input-std:focus { border-color: #03a9e7; box-shadow: 0 0 0 3px rgba(3,169,231,0.1); }
                .label-xs {
                    display: block;
                    font-size: 11px;
                    font-weight: 700;
                    color: #64748b;
                    margin-bottom: 6px;
                    text-transform: uppercase;
                    letter-spacing: 0.06em;
                }
            `}</style>
        </div>
    )
}

// ─── Closed Won Modal ─────────────────────────────────────────────────────────

// ─── Pending Docs Modal — capture banker referral ────────────────────────────
function PendingDocsModal({ initialBankers, onConfirm, onCancel }: {
    initialBankers: ReferredBanker[]
    onConfirm: (bankers: ReferredBanker[]) => void
    onCancel: () => void
}) {
    const [bankers, setBankers] = useState<ReferredBanker[]>(initialBankers)
    return (
        <ModalOverlay>
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-sky-100 flex items-center justify-center">
                    <Briefcase size={20} className="text-[#03a9e7]" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-[#052d4a]">Refer to Banker(s)</h2>
                    <p className="text-sm text-slate-500">Select which banker(s) this case was referred to before moving it to Pending Docs.</p>
                </div>
            </div>
            <BankerMultiSelect value={bankers} onChange={setBankers} />
            <div className="flex gap-3 mt-6">
                <button onClick={onCancel} className="btn-ghost flex-1 justify-center py-2.5 text-sm">Cancel</button>
                <button
                    disabled={bankers.length === 0}
                    onClick={() => onConfirm(bankers)}
                    className="btn-primary py-2.5 text-sm flex items-center gap-2 justify-center disabled:opacity-40"
                    style={{ flex: 2 }}
                >
                    <CheckCircle2 size={16} /> Move to Pending Docs
                </button>
            </div>
        </ModalOverlay>
    )
}

interface LoanFormRow { enabled: boolean; amount: string; tenure: string }

// Vercel rejects a Serverless Function request body over ~4.5MB at the edge,
// before the route runs. A phone photo of an LO is routinely 3-8MB and a
// multi-page upload multiplies that, so images are downscaled before being sent
// for extraction. Only the copy sent to the model shrinks — the ORIGINAL file
// is what gets uploaded to storage on confirm, so the record keeps full quality.
const EXTRACT_MAX_BYTES = 4 * 1024 * 1024
const EXTRACT_MAX_DIM = 1800     // ample for reading an A4 page of text
const EXTRACT_QUALITY = 0.82

async function downscaleForExtraction(file: File): Promise<File> {
    if (!file.type.startsWith('image/')) return file          // PDFs pass through
    if (file.size <= 900_000) return file                     // already small
    try {
        const bitmap = await createImageBitmap(file)
        const scale = Math.min(1, EXTRACT_MAX_DIM / Math.max(bitmap.width, bitmap.height))
        const w = Math.round(bitmap.width * scale)
        const h = Math.round(bitmap.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return file
        ctx.drawImage(bitmap, 0, 0, w, h)
        bitmap.close?.()
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', EXTRACT_QUALITY))
        // Never send something bigger than what we started with.
        if (!blob || blob.size >= file.size) return file
        return new File([blob], file.name, { type: 'image/jpeg' })
    } catch {
        return file   // canvas unavailable — let the size check below decide
    }
}

function ClosedWonModal({ initialData, caseId, onConfirm, onCancel }: {
    initialData: Case
    caseId: string
    onConfirm: (details: Partial<Case>) => Promise<void>
    onCancel: () => void
}) {
    const caseType = (initialData.case_type ?? 'Purchase') as CaseType
    const specs = loanSpecsFor(caseType)
    const existing = (initialData.closed_won_data ?? {}) as ClosedWonData

    const [clientName, setClientName] = useState(initialData.client_name || '')
    const [clientMobile, setClientMobile] = useState(initialData.client_mobile || '')
    const [clientEmail, setClientEmail] = useState(initialData.client_email || '')

    // Per-loan rows, prefilled from the workflow (or an earlier close).
    const [loanRows, setLoanRows] = useState<Record<string, LoanFormRow>>(() => {
        const wf = (initialData.workflow_data ?? {}) as Record<string, unknown>
        const map: Record<string, LoanFormRow> = {}
        for (const spec of specs) {
            const prior = existing.loans?.find(l => l.kind === spec.kind)
            const pf = prior ?? prefillLoan(spec.kind, initialData, wf)
            map[spec.kind] = {
                enabled: spec.required || !!prior || (pf.amount != null && pf.amount > 0),
                amount: pf.amount != null ? String(Math.round(pf.amount)) : '',
                tenure: pf.tenure != null ? String(pf.tenure) : '',
            }
        }
        return map
    })
    const setRow = (kind: ClosedLoanKind, patch: Partial<LoanFormRow>) =>
        setLoanRows(r => ({ ...r, [kind]: { ...r[kind], ...patch } }))

    const [lockin, setLockin] = useState(existing.package?.lockin_years != null ? String(existing.package.lockin_years) : '')
    const [schedule, setSchedule] = useState<RateScheduleEntry[]>(
        existing.package?.schedule?.length ? existing.package.schedule : [{ year: 1, type: 'fixed' }],
    )

    // Captured from the LO. No columns exist for these on the insurance `cases`
    // table, so they persist inside closed_won_data (jsonb).
    const [propertyAddress, setPropertyAddress] = useState(existing.property_address || '')
    // The bank now holding the loan — the starting point of the next cycle (Revisit).
    // Prefill: what was recorded before, else the only bank the case was referred to.
    const [closedBank, setClosedBank] = useState(() => {
        if (existing.bank) return existing.bank
        const banks = [...new Set((initialData.referred_bankers ?? []).map(b => b.bank).filter(Boolean))]
        return banks.length === 1 ? banks[0] : ''
    })
    const [pkgFeatures, setPkgFeatures] = useState<string[]>(existing.package_features ?? [])

    const [hasSubsidy, setHasSubsidy] = useState(!!initialData.subsidy_provided)
    const [subsidyProvided, setSubsidyProvided] = useState(initialData.subsidy_provided || '')
    const [clawbackEnd, setClawbackEnd] = useState(initialData.clawback_end_date || '')
    const [remarks, setRemarks] = useState(initialData.remarks || '')
    const [followUp, setFollowUp] = useState(initialData.follow_up_date || '')
    const [bankers, setBankers] = useState(initialData.referred_bankers ?? [])

    const [keptDocs, setKeptDocs] = useState(existing.lo_documents ?? [])
    const [files, setFiles] = useState<File[]>([])
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)
    // Review page before the final, irreversible submit (+ the agent's confirmation tick).
    const [reviewing, setReviewing] = useState(false)
    const [confirmed, setConfirmed] = useState(false)
    const bodyRef = useRef<HTMLDivElement>(null)

    // LO auto-extraction: reads the attached Letter of Offer and prefills the
    // loan/package fields. Advisory only — every figure stays editable and the
    // agent confirms them, because these feed original_loan_total -> commission.
    const [extracting, setExtracting] = useState(false)
    const [extracted, setExtracted] = useState<ExtractedLo | null>(null)
    const [extractErr, setExtractErr] = useState<string | null>(null)
    const [lastLoFile, setLastLoFile] = useState<File[]>([])

    useEffect(() => {
        fetch('/api/insurance/rates').then(r => r.json()).then(d => { if (d.sora) setSora(d.sora) }).catch(() => {})
    }, [])

    const runExtract = async (pages: File[]) => {
        if (!pages.length) return
        setExtracting(true); setExtractErr(null); setExtracted(null)
        setLastLoFile(pages)
        try {
            // Shrink images first — the full-size originals still go to storage
            // on confirm; only this request is downscaled.
            const sending = await Promise.all(pages.map(downscaleForExtraction))
            const total = sending.reduce((sum, f) => sum + f.size, 0)
            if (total > EXTRACT_MAX_BYTES) {
                throw new Error(sending.length > 1
                    ? 'Those pages are too large to read together. Try attaching fewer at a time.'
                    : 'That file is too large to read. Try a smaller scan or a photo instead.')
            }

            const fd = new FormData()
            // Order matters — these are consecutive pages of one document.
            for (const p of sending) fd.append('file', p)
            fd.append('kinds', specs.map(s => s.kind).join(','))
            // Hard client-side stop. The server budgets itself to ~45s, but a
            // cold serverless start (or a dev-server first compile of pdf-parse)
            // can outlast that, and a spinner that never resolves reads as
            // "the upload is broken" — the agent needs to be released to type.
            const res = await fetch('/api/insurance/cases/extract-lo', {
                method: 'POST', body: fd, signal: AbortSignal.timeout(75000),
            })
            const json = await res.json().catch(() => null)
            if (!res.ok) throw new Error(json?.error || `Could not read that file (HTTP ${res.status}).`)

            const data = json.data as ExtractedLo
            // Apply only what was actually read — never blank a field the agent
            // (or the workflow prefill) already has because the LO omitted it.
            setLoanRows(rows => {
                const next = { ...rows }
                for (const l of data.loans) {
                    if (!next[l.kind]) continue
                    next[l.kind] = {
                        enabled: true,
                        amount: l.amount > 0 ? String(l.amount) : next[l.kind].amount,
                        tenure: l.tenure > 0 ? String(l.tenure) : next[l.kind].tenure,
                    }
                }
                return next
            })
            if (data.lockin_years != null) setLockin(String(data.lockin_years))
            if (data.schedule.length) setSchedule(data.schedule)
            if (data.property_address) setPropertyAddress(data.property_address)
            if (data.bank) setClosedBank(b => b || data.bank!)
            if (data.features.length) setPkgFeatures(data.features)
            // Only ever turns the subsidy section ON. If the LO grants none, an
            // agent who already ticked it keeps what they typed — absence of a
            // subsidy clause is not proof there wasn't one.
            if (data.subsidy) {
                setHasSubsidy(true)
                setSubsidyProvided(data.subsidy)
                if (data.clawback_end_date) setClawbackEnd(data.clawback_end_date)
            }
            setExtracted(data)
        } catch (e) {
            const timedOut = e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')
            setExtractErr(timedOut
                ? 'Reading the Letter of Offer took too long.'
                : e instanceof Error ? e.message : 'Could not read that file.')
        } finally {
            setExtracting(false)
        }
    }

    const LO_READABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

    const addFiles = (picked: File[]) => {
        const all = [...files, ...picked]
        setFiles(all)
        // Re-read EVERY attached page together, not just the new one. An LO
        // photographed page by page is one document — page 1 carries the
        // property address, page 2 the rate table — so reading a single page
        // silently drops whatever lives on the others.
        const readable = all.filter(f => LO_READABLE.includes(f.type))
        if (readable.length && !extracting) void runExtract(readable)
    }

    const loans: ClosedWonLoan[] = specs
        .filter(s => loanRows[s.kind].enabled)
        .map(s => ({
            kind: s.kind,
            amount: parseFloat((loanRows[s.kind].amount || '').replace(/,/g, '')) || 0,
            tenure: parseInt(loanRows[s.kind].tenure) || 0,
        }))
    const lockinYears = parseInt(lockin) || 0
    const totals = closedWonTotals(loans, schedule, lockinYears, sora)

    const enabledValid = loans.length > 0 && loans.every(l => l.amount > 0 && l.tenure > 0)
    const canSave = !busy && clientName.trim() && enabledValid

    // "+ Add feature" starts a blank row; don't persist ones left empty.
    const cleanFeatures = pkgFeatures.map(f => f.trim()).filter(Boolean)

    // Did the extraction actually put anything in the form? Drives the banner —
    // claiming "filled in from the LO" over an untouched form reads as a lie.
    const filledSomething = !!extracted && (
        extracted.loans.length > 0 ||
        extracted.schedule.length > 0 ||
        !!extracted.property_address ||
        extracted.features.length > 0 ||
        !!extracted.subsidy
    )

    const handleConfirm = async () => {
        if (!canSave || !reviewing || !confirmed || extracting) return
        setBusy(true); setErr(null)
        try {
            // Upload any newly attached LO files to the agent's own folder.
            const uploaded = [...keptDocs]
            if (files.length) {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) throw new Error('Please sign in again before submitting.')
                if (user) {
                    for (const f of files) {
                        const ext = f.name.split('.').pop()
                        const path = `${user.id}/${caseId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
                        const { error } = await supabase.storage.from('insurance-documents').upload(path, f)
                        if (error) throw new Error(`Upload failed: ${error.message}`)
                        uploaded.push({ path, name: f.name, type: f.type })
                    }
                }
            }

            const closed_won_data: ClosedWonData = {
                loans,
                package: { lockin_years: lockinYears, schedule },
                lo_documents: uploaded,
                original_loan_total: totals.originalLoanTotal,
                combined_outstanding: totals.combinedOutstanding ?? undefined,
                property_address: propertyAddress.trim() || undefined,
                package_features: cleanFeatures.length ? cleanFeatures : undefined,
                bank: closedBank.trim() || undefined,
                // Kept from the first close if the agent edits the closure later.
                closed_at: existing.closed_at ?? todaySgt(),
            }

            const firstYear = schedule.find(e => !e.thereafter)
            await onConfirm({
                client_name: clientName.trim(),
                client_mobile: clientMobile.trim() || undefined,
                client_email: clientEmail.trim() || undefined,
                subsidy_provided: hasSubsidy ? (subsidyProvided || undefined) : undefined,
                clawback_end_date: hasSubsidy ? (clawbackEnd || undefined) : undefined,
                remarks: remarks || undefined,
                referred_bankers: bankers,
                follow_up_date: followUp || undefined,
                closed_won_data,
                // Legacy columns kept in sync for existing overview/list displays.
                closed_package_details: packageSummary(schedule, lockinYears) || undefined,
                closed_tenure: loans[0]?.tenure,
                closed_interest_rate: firstYear?.type === 'fixed' ? firstYear.rate : undefined,
            })
        } catch (e) {
            setErr(e instanceof Error ? e.message : 'Something went wrong')
            setBusy(false)
        }
    }

    const sectionLabel = 'text-xs font-bold text-slate-500 uppercase tracking-wide'
    const money = (n: number) => `$${Math.round(n).toLocaleString()}`

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.65)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3 bg-emerald-50/50 shrink-0">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                        <CheckCircle2 size={22} className="text-emerald-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-[#052d4a]">Closed Won Details</h2>
                        <p className="text-sm text-slate-500">Confirm the final loan(s) and package from the Letter of Offer.</p>
                    </div>
                </div>

                <div ref={bodyRef} className="px-6 py-5 space-y-6 overflow-y-auto">
                    {/* Deterrent 1 — reminder while keying in (always visible) */}
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
                        <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-900 leading-relaxed">
                            <b>Submitting a case as Closed Won is final.</b> You won&apos;t be able to edit it afterwards, so check every figure against the Letter of Offer.
                            If TLC has to correct a wrong submission, a <b>${CORRECTION_FEE} correction admin fee</b> is deducted from your payout.
                        </p>
                    </div>

                    {reviewing ? (() => {
                        // Deterrent 2 — the review page. Everything they're about to submit, in one place.
                        const docCount = keptDocs.length + files.length
                        const warnings = [
                            docCount === 0 && 'No Letter of Offer attached — TLC checks every closure against it.',
                            !closedBank.trim() && 'No bank selected.',
                            lockinYears <= 0 && 'No lock-in period — the projected outstanding at lock-in end can\'t be worked out.',
                            !followUp && 'No follow-up date — you won\'t be reminded to revisit this client when the lock-in ends.',
                        ].filter(Boolean) as string[]
                        const row = (label: string, value: React.ReactNode) => (
                            <div className="flex items-start justify-between gap-4 py-1.5 border-b border-slate-50 last:border-b-0">
                                <span className="text-xs text-slate-500 shrink-0">{label}</span>
                                <span className="text-sm font-semibold text-[#052d4a] text-right">{value || <span className="text-slate-300 font-normal">—</span>}</span>
                            </div>
                        )
                        const box = 'rounded-xl border border-slate-100 px-4 py-2'
                        return (
                            <div className="space-y-4">
                                <div>
                                    <p className="text-base font-bold text-[#052d4a]">Are these details in order?</p>
                                    <p className="text-xs text-slate-500 mt-0.5">Check each one against the Letter of Offer before you submit.</p>
                                </div>

                                {warnings.length > 0 && (
                                    <ul className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-1">
                                        {warnings.map(w => <li key={w} className="text-xs text-red-700 flex gap-2"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</li>)}
                                    </ul>
                                )}

                                <div>
                                    <p className={sectionLabel}>Loan(s)</p>
                                    <div className={box}>
                                        {loans.map(l => row(CLOSED_LOAN_LABELS[l.kind], `${money(l.amount)} · ${l.tenure} yrs`))}
                                        {loans.length > 1 && row('Total', money(totals.originalLoanTotal))}
                                    </div>
                                </div>

                                <div>
                                    <p className={sectionLabel}>Package</p>
                                    <div className={box}>
                                        {row('Bank', closedBank.trim())}
                                        {row('Lock-in', lockinYears > 0 ? `${lockinYears} yr${lockinYears > 1 ? 's' : ''}` : '')}
                                        {row('Rates', packageSummary(schedule, lockinYears))}
                                        {cleanFeatures.length > 0 && row('Features', cleanFeatures.join(', '))}
                                        {row('Subsidy', hasSubsidy ? `${subsidyProvided || 'Yes'}${clawbackEnd ? ` · clawback until ${clawbackEnd}` : ''}` : 'None')}
                                    </div>
                                </div>

                                <div>
                                    <p className={sectionLabel}>Client &amp; property</p>
                                    <div className={box}>
                                        {row('Client', clientName.trim())}
                                        {row('Mobile', clientMobile.trim())}
                                        {row('Email', clientEmail.trim())}
                                        {row('Property address', propertyAddress.trim())}
                                    </div>
                                </div>

                                <div>
                                    <p className={sectionLabel}>Paperwork &amp; follow-up</p>
                                    <div className={box}>
                                        {row('Letter of Offer', [...keptDocs.map(d => d.name), ...files.map(f => f.name)].join(', '))}
                                        {row('Subsidy', hasSubsidy ? subsidyProvided : 'None')}
                                        {row('Clawback end date', hasSubsidy ? clawbackEnd : '')}
                                        {row('Remarks', remarks)}
                                        {row('Referred banker(s)', bankers.map(b => `${b.name} (${b.bank})`).join(', '))}
                                        {row('Follow-up date', followUp)}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 grid grid-cols-2 gap-3">
                                    <div>
                                        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Your commission (this close)</p>
                                        <p className="text-lg font-extrabold text-emerald-700">{money(commissionWithFee(totals.originalLoanTotal, initialData.correction_fee).agent)}</p>
                                        {!!initialData.correction_fee && <p className="text-xs text-red-700">After {money(initialData.correction_fee)} correction fee</p>}
                                    </div>
                                    {totals.combinedOutstanding != null && (
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Outstanding at lock-in end</p>
                                            <p className="text-lg font-extrabold text-[#052d4a]">{money(totals.combinedOutstanding)}</p>
                                        </div>
                                    )}
                                </div>

                                <label className="flex items-start gap-2.5 rounded-xl border-2 border-[#052d4a]/15 px-4 py-3 cursor-pointer select-none">
                                    <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#166534] shrink-0" />
                                    <span className="text-xs text-slate-700 leading-relaxed">
                                        I&apos;ve checked every detail above against the Letter of Offer. I understand this submission is <b>final</b>, and that if TLC has to correct it,
                                        a <b>${CORRECTION_FEE} correction fee</b> will be deducted from my payout.
                                    </span>
                                </label>
                            </div>
                        )
                    })() : (<>

                    {/* Client */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                            <label className="label-xs">Client Name *</label>
                            <input required type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. John Tan" className="input-std" />
                        </div>
                        <div>
                            <label className="label-xs">Mobile</label>
                            <input type="tel" value={clientMobile} onChange={e => setClientMobile(e.target.value)} placeholder="+65 9123 4567" className="input-std" />
                        </div>
                        <div>
                            <label className="label-xs">Email</label>
                            <input type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="client@email.com" className="input-std" />
                        </div>
                        <div>
                            <label className="label-xs">Bank <span className="text-slate-400 normal-case">(now holding the loan)</span></label>
                            <InsuranceBankDropdown value={closedBank} onChange={setClosedBank} placeholder="Select bank…" />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="label-xs">Property Address <span className="text-slate-400 normal-case">(as per the LO)</span></label>
                            <input type="text" value={propertyAddress} onChange={e => setPropertyAddress(e.target.value)}
                                placeholder="e.g. 123 Bishan Street 12 #08-45 Singapore 570123" className="input-std" />
                        </div>
                    </div>

                    {/* AI-filled warning — these figures drive the commission base,
                        so the agent must be told which ones they're vouching for. */}
                    {extracted && (
                        <div className={`rounded-lg border px-3.5 py-3 space-y-1.5 ${filledSomething ? 'border-amber-200 bg-amber-50/70' : 'border-slate-200 bg-slate-50'}`}>
                            <div className="flex items-start gap-2">
                                {filledSomething
                                    ? <Sparkles size={15} className="text-amber-600 shrink-0 mt-0.5" />
                                    : <AlertTriangle size={15} className="text-slate-400 shrink-0 mt-0.5" />}
                                <div className="flex-1 text-sm">
                                    {filledSomething ? (
                                        <>
                                            <p className="font-semibold text-amber-900">
                                                Filled in from the Letter of Offer{extracted.bank ? ` (${extracted.bank})` : ''} — check every figure.
                                            </p>
                                            <p className="text-amber-800/90 text-[13px] mt-0.5">
                                                {extracted.source === 'vision'
                                                    ? 'Read from an image, so digits are easier to misread.'
                                                    : 'Read from the PDF text.'} These amounts set the commission base.
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="font-semibold text-slate-700">Nothing could be read from this file.</p>
                                            <p className="text-slate-500 text-[13px] mt-0.5">
                                                Enter the details below by hand — the file is still attached and will be saved.
                                            </p>
                                        </>
                                    )}
                                </div>
                                <button type="button" onClick={() => setExtracted(null)} className={`shrink-0 ${filledSomething ? 'text-amber-400 hover:text-amber-700' : 'text-slate-300 hover:text-slate-600'}`}><X size={14} /></button>
                            </div>
                            {extracted.notes.length > 0 && (
                                <ul className={`text-[13px] list-disc pl-8 space-y-0.5 ${filledSomething ? 'text-amber-800/90' : 'text-slate-500'}`}>
                                    {extracted.notes.map((n, i) => <li key={i}>{n}</li>)}
                                </ul>
                            )}
                        </div>
                    )}

                    {/* Loans */}
                    <div className="space-y-3">
                        <p className={sectionLabel}>Loan(s) in the Letter of Offer</p>
                        {specs.map(spec => {
                            const row = loanRows[spec.kind]
                            return (
                                <div key={spec.kind} className={`rounded-lg border p-3.5 ${row.enabled ? 'border-slate-200' : 'border-slate-100 bg-slate-50/50'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={row.enabled}
                                            disabled={spec.required}
                                            onChange={e => setRow(spec.kind, { enabled: e.target.checked })}
                                            className="rounded border-slate-300 accent-emerald-600 disabled:opacity-60"
                                        />
                                        <span className="text-sm font-semibold text-slate-700">{spec.label}</span>
                                        {spec.required && <span className="text-[10px] text-slate-400">(required)</span>}
                                    </label>
                                    {row.enabled && (
                                        <div className="grid grid-cols-2 gap-3 mt-3">
                                            <div>
                                                <label className="label-xs">Loan Amount</label>
                                                <input inputMode="numeric" value={row.amount}
                                                    onChange={e => setRow(spec.kind, { amount: e.target.value.replace(/[^\d]/g, '') })}
                                                    placeholder="e.g. 300000" className="input-std" />
                                            </div>
                                            <div>
                                                <label className="label-xs">Tenure (years)</label>
                                                <input inputMode="numeric" value={row.tenure}
                                                    onChange={e => setRow(spec.kind, { tenure: e.target.value.replace(/[^\d]/g, '') })}
                                                    placeholder="e.g. 20" className="input-std" />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* Package */}
                    <div className="space-y-3">
                        <p className={sectionLabel}>Package (applies to all loans above)</p>
                        <div>
                            <label className="label-xs">Lock-in Period (yrs)</label>
                            <input inputMode="numeric" value={lockin} onChange={e => setLockin(e.target.value.replace(/[^\d]/g, ''))}
                                placeholder="e.g. 2" className="input-std" style={{ maxWidth: 160 }} />
                        </div>
                        <div>
                            <label className="label-xs">Interest Rates (p.a.)</label>
                            <RateScheduleEditor schedule={schedule} onChange={setSchedule} />
                        </div>
                        <div>
                            <label className="label-xs">Package Features</label>
                            <div className="space-y-1.5">
                                {pkgFeatures.map((f, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <input type="text" value={f} className="input-std flex-1"
                                            onChange={e => setPkgFeatures(arr => arr.map((x, idx) => idx === i ? e.target.value : x))} />
                                        <button type="button" onClick={() => setPkgFeatures(arr => arr.filter((_, idx) => idx !== i))}
                                            className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
                                    </div>
                                ))}
                                <button type="button" onClick={() => setPkgFeatures(arr => [...arr, ''])}
                                    className="text-sm font-medium text-[#03a9e7] hover:text-[#0290c5]">+ Add feature</button>
                            </div>
                        </div>
                    </div>

                    {/* Projection preview */}
                    {totals.originalLoanTotal > 0 && (
                        <div className="rounded-lg border border-[#03a9e7]/20 bg-sky-50/40 p-4 space-y-2">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-500">Total loan (this close)</span>
                                <span className="font-bold text-[#052d4a]">{money(totals.originalLoanTotal)}</span>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-slate-500">Commission now <span className="text-slate-400">(0.15%, agent 90%)</span></span>
                                <span className="font-bold text-emerald-600">{money(totals.thisCommission.agent)}</span>
                            </div>
                            {totals.combinedOutstanding != null && (
                                <>
                                    <div className="flex items-center justify-between text-sm border-t border-sky-100 pt-2">
                                        <span className="text-slate-500">Combined outstanding after {lockinYears}-yr lock-in</span>
                                        <span className="font-bold text-[#052d4a]">{money(totals.combinedOutstanding)}</span>
                                    </div>
                                    {totals.nextCommission && (
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-slate-500 flex items-center gap-1"><TrendingUp size={13} className="text-[#03a9e7]" /> Projected next-cycle commission</span>
                                            <span className="font-bold text-[#03a9e7]">{money(totals.nextCommission.agent)}</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Subsidy */}
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input type="checkbox" checked={hasSubsidy} onChange={e => setHasSubsidy(e.target.checked)} className="rounded border-slate-300 accent-emerald-600" />
                            <span className="text-sm font-semibold text-slate-700">Subsidy provided</span>
                        </label>
                        {hasSubsidy && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="label-xs">Subsidy Provided</label>
                                    <input type="text" value={subsidyProvided} onChange={e => setSubsidyProvided(e.target.value)} placeholder="e.g. $2,000" className="input-std" />
                                </div>
                                <div>
                                    <label className="label-xs">Clawback End Date</label>
                                    <input type="date" value={clawbackEnd} onChange={e => setClawbackEnd(e.target.value)} className="input-std" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Letter of Offer upload */}
                    <div className="space-y-2">
                        <p className={sectionLabel}>Letter of Offer</p>
                        {keptDocs.length > 0 && (
                            <div className="space-y-1.5">
                                {keptDocs.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                                        <FileText size={14} className="text-slate-400 shrink-0" />
                                        <span className="flex-1 truncate text-slate-700">{d.name}</span>
                                        <button type="button" onClick={() => setKeptDocs(arr => arr.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {files.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm bg-emerald-50/60 rounded-lg px-3 py-2">
                                <FileText size={14} className="text-emerald-500 shrink-0" />
                                <span className="flex-1 truncate text-slate-700">{f.name}</span>
                                <button type="button" onClick={() => setFiles(arr => arr.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
                            </div>
                        ))}
                        <label className="flex items-center gap-2 text-sm font-medium text-[#03a9e7] cursor-pointer hover:text-[#0290c5] w-fit">
                            <Upload size={15} /> Add PDF / images
                            <input type="file" multiple accept="application/pdf,image/*" className="hidden"
                                onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} />
                        </label>

                        {/* Extraction status — the loan/package fields above are what got filled. */}
                        {extracting && (
                            <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                                <Loader2 size={14} className="animate-spin shrink-0" />
                                {lastLoFile.length > 1
                                    ? `Reading the Letter of Offer (${lastLoFile.length} pages)…`
                                    : 'Reading the Letter of Offer…'}
                            </div>
                        )}
                        {!extracting && extractErr && (
                            <div className="flex items-start gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                                <AlertTriangle size={14} className="text-slate-400 shrink-0 mt-0.5" />
                                <span className="flex-1 text-slate-600">{extractErr} Fill the loan details in by hand.</span>
                                {lastLoFile.length > 0 && (
                                    <button type="button" onClick={() => void runExtract(lastLoFile)} className="font-medium text-[#03a9e7] hover:text-[#0290c5] shrink-0">Retry</button>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Banker(s) */}
                    <div className="space-y-2">
                        <p className={sectionLabel}>Referred Banker(s)</p>
                        <BankerMultiSelect value={bankers} onChange={setBankers} />
                    </div>

                    {/* Follow-up */}
                    <div>
                        <label className="label-xs">Follow-up Date <span className="text-slate-400 normal-case">(syncs to your Google Calendar)</span></label>
                        <input type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} className="input-std" style={{ maxWidth: 200 }} />
                    </div>

                    {/* Remarks */}
                    <div>
                        <label className="label-xs">Remarks</label>
                        <textarea rows={3} value={remarks} onChange={e => setRemarks(e.target.value)} className="input-std" style={{ fontFamily: 'inherit', resize: 'vertical' }} />
                    </div>

                    </>)}

                    {err && <InlineAlert type="error" message={err} onDismiss={() => setErr(null)} />}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 shrink-0 bg-slate-50/50">
                    {reviewing ? (
                        <>
                            <button onClick={() => { setReviewing(false); setConfirmed(false); bodyRef.current?.scrollTo({ top: 0 }) }} disabled={busy}
                                className="btn-ghost flex-1 justify-center py-2.5 text-sm">← Back to edit</button>
                            <button
                                disabled={!canSave || !confirmed || extracting}
                                onClick={handleConfirm}
                                className="btn-primary py-2.5 text-sm flex items-center gap-2 justify-center disabled:opacity-40"
                                style={{ flex: 2, background: '#166534', borderColor: '#166534' }}
                            >
                                {busy ? <Spinner size="sm" color="white" label="Saving…" /> : <><CheckCircle2 size={16} /> Confirm &amp; submit Closed Won</>}
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={onCancel} disabled={busy} className="btn-ghost flex-1 justify-center py-2.5 text-sm">Cancel</button>
                            <button
                                disabled={!canSave || extracting}
                                onClick={() => { setReviewing(true); bodyRef.current?.scrollTo({ top: 0 }) }}
                                className="btn-primary py-2.5 text-sm flex items-center gap-2 justify-center disabled:opacity-40"
                                style={{ flex: 2, background: '#166534', borderColor: '#166534' }}
                            >
                                Review &amp; submit →
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Closed Lost Modal ────────────────────────────────────────────────────────

function ClosedLostModal({ onConfirm, onCancel }: {
    onConfirm: (reason: string, notes: string) => void
    onCancel: () => void
}) {
    const [reason, setReason] = useState('')
    const [notes, setNotes] = useState('')

    return (
        <ModalOverlay>
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                    <AlertTriangle size={20} className="text-red-600" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-[#052d4a]">Mark as Closed Lost</h2>
                    <p className="text-sm text-slate-500">Please record why this case was lost.</p>
                </div>
            </div>
            <div className="space-y-4">
                <div>
                    <label className="label-xs">Loss Reason *</label>
                    <select
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        className="input-std"
                        autoFocus
                    >
                        <option value="">Select a reason…</option>
                        {CLOSED_LOST_REASONS.map(r => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="label-xs">Additional Notes (optional)</label>
                    <textarea
                        rows={3}
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Any additional context…"
                        className="input-std"
                        style={{ fontFamily: 'inherit', resize: 'vertical' }}
                    />
                </div>
            </div>
            <div className="flex gap-3 mt-6">
                <button onClick={onCancel} className="btn-ghost flex-1 justify-center py-2.5 text-sm">Cancel</button>
                <button
                    disabled={!reason}
                    onClick={() => onConfirm(reason, notes)}
                    className="flex-2 py-2.5 text-sm rounded-lg font-semibold text-white flex items-center gap-2 justify-center transition-colors"
                    style={{ flex: 2, background: reason ? '#dc2626' : '#fca5a5', cursor: reason ? 'pointer' : 'not-allowed' }}
                >
                    <X size={15} /> Confirm Closed Lost
                </button>
            </div>
        </ModalOverlay>
    )
}

// ─── Shared layout helpers ────────────────────────────────────────────────────

function ModalOverlay({ children }: { children: React.ReactNode }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.65)', backdropFilter: 'blur(4px)' }}>
            <div className="card w-full max-w-xl p-7 shadow-2xl">
                {children}
            </div>
        </div>
    )
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
    return (
        <div className="card p-6">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                    <Icon size={16} className="text-slate-500" />
                </div>
                <h3 className="font-bold text-slate-800">{title}</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {children}
            </div>
        </div>
    )
}

function GridField({ label, children, isEditing, fullWidth }: { label: string; children: React.ReactNode; isEditing: boolean; fullWidth?: boolean }) {
    const childArray = React.Children.toArray(children)
    return (
        <div style={{ gridColumn: fullWidth ? '1 / -1' : 'auto' }}>
            <label className="label-xs">{label}</label>
            {isEditing
                ? <div>{childArray[0]}</div>
                : <div className="text-sm font-medium text-slate-800 min-h-[22px]">{childArray[1]}</div>
            }
        </div>
    )
}

// ─── Referred bankers (internal CRM) ──────────────────────────────────────────
// Auto-saves on every add/remove — no edit mode required.
function BankerControl({ value, onSave }: { value: ReferredBanker[]; onSave: (v: ReferredBanker[]) => void }) {
    return (
        <div className="card p-6">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                    <Briefcase size={16} className="text-slate-500" />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800">Referred Banker(s)</h3>
                    <p className="text-xs text-slate-400">Who this case has been referred to. Changes save automatically.</p>
                </div>
            </div>
            <BankerMultiSelect value={value} onChange={onSave} />
        </div>
    )
}

// ─── Closed-Won summary (loans, commission, next-cycle projection) ────────────
function ClosedWonSummaryCard({ data, isAdmin, onTogglePaid }: { data: Case; isAdmin: boolean; onTogglePaid: () => void }) {
    const cwd = data.closed_won_data ?? {}
    const loans = cwd.loans ?? []
    const money = (n: number) => `$${Math.round(n).toLocaleString()}`
    const lockin = cwd.package?.lockin_years ?? 0
    const original = cwd.original_loan_total ?? loans.reduce((s, l) => s + l.amount, 0)
    const outstanding = cwd.combined_outstanding
    const now = commissionWithFee(original, data.correction_fee)
    const next = outstanding != null ? calculateCommission(outstanding) : null
    const paid = data.commission_status === 'paid'

    const openDoc = async (path: string) => {
        const { data: signed } = await supabase.storage.from('insurance-documents').createSignedUrl(path, 120)
        if (signed?.signedUrl) window.open(signed.signedUrl, '_blank')
    }

    return (
        <div className="card p-6 space-y-5">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                </div>
                <div>
                    <h3 className="font-bold text-slate-800">Closed Won Summary</h3>
                    {data.closed_package_details && <p className="text-xs text-slate-400">{data.closed_package_details}</p>}
                </div>
            </div>

            {/* Property + package features captured from the LO */}
            {(cwd.property_address || cwd.package_features?.length) && (
                <div className="space-y-2">
                    {cwd.property_address && (
                        <div className="flex items-start gap-2 text-sm">
                            <Home size={14} className="text-slate-400 shrink-0 mt-0.5" />
                            <span className="text-slate-700">{cwd.property_address}</span>
                        </div>
                    )}
                    {cwd.package_features?.length ? (
                        <ul className="text-sm text-slate-600 list-disc pl-6 space-y-0.5">
                            {cwd.package_features.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                    ) : null}
                </div>
            )}

            {/* Loans */}
            <div className="space-y-2">
                {loans.map((l, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">{CLOSED_LOAN_LABELS[l.kind]}</span>
                        <span className="font-semibold text-slate-700">{money(l.amount)} · {l.tenure} yrs</span>
                    </div>
                ))}
                <div className="flex items-center justify-between text-sm border-t border-dashed border-slate-200 pt-2">
                    <span className="font-semibold text-slate-600">Total loan closed</span>
                    <span className="font-bold text-[#052d4a]">{money(original)}</span>
                </div>
            </div>

            {/* Commission now + next cycle */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg bg-emerald-50/60 border border-emerald-100 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Commission (this close)</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={paid ? { color: '#16a34a', background: '#dcfce7' } : { color: '#d97706', background: '#fef3c7' }}>
                            {paid ? 'Paid' : 'Unpaid'}
                        </span>
                    </div>
                    <p className="text-xl font-bold text-emerald-700 mt-0.5">{money(now.agent)}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                        0.15% of {money(original)} · agent 90%
                        {now.correctionFee > 0 && <span className="text-red-600 font-semibold"> · −{money(now.correctionFee)} correction fee</span>}
                    </p>
                    {isAdmin && (
                        <button type="button" onClick={onTogglePaid}
                            className="mt-2 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors"
                            style={paid ? { color: '#64748b', borderColor: '#e2e8f0' } : { color: '#16a34a', borderColor: '#bbf7d0' }}>
                            {paid ? 'Mark as unpaid' : 'Mark commission paid'}
                        </button>
                    )}
                </div>
                {next != null && outstanding != null ? (
                    <div className="rounded-lg bg-sky-50/60 border border-sky-100 p-3.5">
                        <p className="text-[11px] font-semibold text-[#0369a1] uppercase tracking-wide flex items-center gap-1">
                            <TrendingUp size={12} /> Projected next cycle
                        </p>
                        <p className="text-xl font-bold text-[#03a9e7] mt-0.5">{money(next.agent)}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                            {money(outstanding)} outstanding after {lockin}-yr lock-in · agent 90%
                        </p>
                    </div>
                ) : (
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3.5 flex items-center">
                        <p className="text-[11px] text-slate-400">Add a lock-in period & rates to project next-cycle income.</p>
                    </div>
                )}
            </div>

            {/* LO documents */}
            {cwd.lo_documents && cwd.lo_documents.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Letter of Offer</p>
                    {cwd.lo_documents.map((d, i) => (
                        <button key={i} type="button" onClick={() => openDoc(d.path)}
                            className="flex items-center gap-2 text-sm text-[#03a9e7] hover:underline w-full text-left">
                            <FileText size={14} className="shrink-0" /> <span className="truncate">{d.name}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── Follow-up reminder (internal CRM) ────────────────────────────────────────
// Lives on the Overview tab, never inside the client-facing Workflow tab.
function FollowUpControl({ value, onSave, saving }: { value?: string; onSave: (date: string) => void; saving?: boolean }) {
    const [date, setDate] = useState(value ?? '')
    return (
        <div className="card p-6">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                    <CalendarClock size={16} className="text-slate-500" />
                </div>
                <h3 className="font-bold text-slate-800">Follow-up Reminder</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
                <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="input-std"
                    style={{ maxWidth: 200 }}
                />
                <button
                    type="button"
                    disabled={!date || saving}
                    onClick={() => onSave(date)}
                    className="btn-primary text-sm px-4 py-2 disabled:opacity-40"
                >
                    {saving ? 'Saving…' : 'Set reminder'}
                </button>
                {value && (
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => { setDate(''); onSave('') }}
                        className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-red-600 hover:border-red-200 disabled:opacity-40 flex items-center gap-1.5"
                    >
                        <X size={14} /> Clear
                    </button>
                )}
                {value && (
                    <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 size={13} /> Saved · {new Date(value).toLocaleDateString()}
                    </span>
                )}
            </div>
        </div>
    )
}
