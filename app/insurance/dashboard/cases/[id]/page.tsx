'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Case, PipelineStage } from '@/lib/types'
import { RefinancingWorkflow as RefinancingWorkflowData, getRefinancingWorkflow, PurchaseWorkflow, getPurchaseWorkflow } from '@/lib/types/workflow'
import RefinancingWorkflowPanel from '@/components/insurance/workflow/RefinancingWorkflow'
import PurchaseWorkflowPanel from '@/components/insurance/workflow/PurchaseWorkflow'
import PurchaseOverview from '@/components/insurance/workflow/PurchaseOverview'
import { computePurchase, inputsFromWorkflow } from '@/lib/insurance/purchaseCalc'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import {
    ArrowLeft, Save, Edit2, X, User, Home,
    Briefcase, CheckCircle2, AlertTriangle, FileText, CalendarClock
} from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import Skeleton from '@/components/shared/Skeleton'
import { refreshCases } from '@/lib/insurance/useCases'

type TabKey = 'overview' | 'workflow' | 'closure'

const PIPELINE_STAGES: PipelineStage[] = [
    'Touched Base',
    'Proposal Given',
    'Referred to Bank',
    'Pending Approval',
    'Pending Signature',
    'Closed Won',
    'Closed Lost',
]

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
    const router = useRouter()
    const params = useParams()
    const caseId = params?.id as string
    // Router-aware search params — reliable during App Router client navigation
    // (window.location can still hold the previous URL on the first render).
    const searchParams = useSearchParams()
    const initialTab = ((): TabKey => {
        const tab = searchParams.get('tab')
        return tab === 'workflow' || tab === 'closure' ? (tab as TabKey) : 'overview'
    })()

    const [caseData, setCaseData] = useState<Case | null>(null)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [isEditing, setIsEditing] = useState(false)
    const [userRole, setUserRole] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<TabKey>(initialTab)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    // Workflow state (shape depends on case_type)
    const [workflowData, setWorkflowData] = useState<RefinancingWorkflowData | PurchaseWorkflow>({})
    const [workflowSaving, setWorkflowSaving] = useState(false)
    const [workflowSaved, setWorkflowSaved] = useState(false)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Always-current case type — extractCaseFields runs inside a memoized callback
    // whose caseData closure can be stale, which would mis-route the column sync.
    const caseTypeRef = useRef<string | undefined>(undefined)

    // Overview's client-details block — the workflow hand-off scrolls here and
    // focuses the name field instead of dumping the agent at a random position.
    const clientSectionRef = useRef<HTMLDivElement>(null)
    const wantScrollToClientRef = useRef(false)

    // Closed Won modal
    const [closedWonOpen, setClosedWonOpen] = useState(false)
    // Closed Lost modal
    const [closedLostOpen, setClosedLostOpen] = useState(false)

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

        if (error || !data) {
            router.push('/insurance/dashboard/cases')
        } else {
            caseTypeRef.current = data.case_type
            setCaseData(data)
            setWorkflowData(data.case_type === 'Purchase'
                ? getPurchaseWorkflow(data.workflow_data)
                : getRefinancingWorkflow(data.workflow_data))
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
            refreshCases() // keep dashboard / cases-list cache in sync
            setIsEditing(false)
            setAlert({ type: 'success', message: 'Case updated successfully.' })
        }
    }

    // Extract case-column values from workflow data so Overview stays in sync
    const extractCaseFields = (wf: RefinancingWorkflowData | PurchaseWorkflow): Partial<Case> => {
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

    const saveWorkflow = useCallback(async (wf: RefinancingWorkflowData | PurchaseWorkflow) => {
        setWorkflowSaving(true)
        setWorkflowSaved(false)
        const caseFields = extractCaseFields(wf)
        const err = await persistCaseUpdate({ workflow_data: wf, ...caseFields })
        setWorkflowSaving(false)
        if (!err) { setWorkflowSaved(true); setTimeout(() => setWorkflowSaved(false), 2000) }
        else setAlert({ type: 'error', message: `Workflow save failed: ${err}` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [persistCaseUpdate])

    const handleWorkflowChange = useCallback((updated: RefinancingWorkflowData | PurchaseWorkflow) => {
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
        handleFieldChange('stage', newStage)
    }

    // Set a follow-up reminder date — set from the internal Overview tab.
    const handleSetFollowUp = useCallback(async (date: string) => {
        setCaseData(prev => prev ? { ...prev, follow_up_date: date } : prev)
        const err = await persistCaseUpdate({ follow_up_date: date })
        if (err) setAlert({ type: 'error', message: `Follow-up save failed: ${err}` })
        else { refreshCases(); setAlert({ type: 'success', message: 'Follow-up reminder set.' }) }
    }, [persistCaseUpdate])

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
        })
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

    const isRefiOrEquity = caseData.case_type === 'Refinancing' || caseData.case_type === 'Equity Loan'
    const isClosedWon = caseData.stage === 'Closed Won'
    const isClosedLost = caseData.stage === 'Closed Lost'
    const isClosed = isClosedWon || isClosedLost

    const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
        { key: 'overview', label: 'Overview', icon: User },
        { key: 'workflow', label: 'Workflow', icon: Briefcase },
        { key: 'closure', label: 'Closure', icon: CheckCircle2 },
    ]

    return (
        <div className="max-w-4xl mx-auto space-y-5">
            {/* Back + Header */}
            <div>
                <button
                    onClick={() => router.push('/insurance/dashboard/cases')}
                    className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 font-medium mb-3 transition-colors"
                >
                    <ArrowLeft size={15} /> Back to Pipeline
                </button>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="ios-page-title">
                                {caseData.client_name || 'Unnamed Case'}
                            </h1>
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
                    </div>
                    {/* Stage progress dots */}
                    <div className="hidden md:flex items-center gap-1.5">
                        {PIPELINE_STAGES.filter(s => s !== 'Closed Lost').map((s, i) => {
                            const stageIndex = PIPELINE_STAGES.indexOf(caseData.stage)
                            const thisIndex = PIPELINE_STAGES.indexOf(s)
                            const isActive = s === caseData.stage
                            const isPast = thisIndex < stageIndex && !isClosed
                            return (
                                <div key={s} className="flex items-center gap-1.5">
                                    <div className={`w-2 h-2 rounded-full transition-all ${
                                        isActive ? 'bg-white w-3 h-3' :
                                        isPast ? 'bg-white/60' : 'bg-white/25'
                                    }`} title={s} />
                                    {i < PIPELINE_STAGES.filter(s => s !== 'Closed Lost').length - 1 && (
                                        <div className={`w-5 h-px ${isPast ? 'bg-white/60' : 'bg-white/20'}`} />
                                    )}
                                </div>
                            )
                        })}
                    </div>
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
                    {/* Deal summary leads the tab — it's the natural "overview". */}
                    {caseData.case_type === 'Purchase' ? (
                        <PurchaseOverview
                            workflow={workflowData as PurchaseWorkflow}
                            stage={caseData.stage}
                            followUpDate={caseData.follow_up_date}
                            onOpenWorkflow={() => setActiveTab('workflow')}
                        />
                    ) : (
                    <>
                    {/* Loan & Property */}
                    <SectionCard title="Loan & Property" icon={Home}>
                        <GridField label="Property Type" isEditing={isEditing}>
                            <input type="text" value={caseData.property_type || ''} onChange={e => handleFieldChange('property_type', e.target.value)} placeholder="e.g. HDB 4-Room" className="input-std" />
                            {caseData.property_type || <span className="text-slate-400">—</span>}
                        </GridField>
                        <GridField label="Property Price" isEditing={isEditing}>
                            <PrefixInput prefix="$" value={caseData.property_price?.toString() || ''} onChange={v => handleFieldChange('property_price', v ? parseFloat(v) : null)} type="number" />
                            {caseData.property_price ? `$${caseData.property_price.toLocaleString()}` : <span className="text-slate-400">—</span>}
                        </GridField>

                        {isRefiOrEquity ? (
                            <>
                                <GridField label="Existing Loan Amount" isEditing={isEditing}>
                                    <PrefixInput prefix="$" value={caseData.existing_loan_amount?.toString() || ''} onChange={v => handleFieldChange('existing_loan_amount', v ? parseFloat(v) : null)} type="number" />
                                    {caseData.existing_loan_amount ? `$${caseData.existing_loan_amount.toLocaleString()}` : <span className="text-slate-400">—</span>}
                                </GridField>
                                <GridField label="Current Bank" isEditing={isEditing}>
                                    <InsuranceBankDropdown value={caseData.current_bank || ''} onChange={v => handleFieldChange('current_bank', v)} />
                                    {caseData.current_bank || <span className="text-slate-400">—</span>}
                                </GridField>
                                <GridField label="Lock-in End Date" isEditing={isEditing}>
                                    <input type="date" value={caseData.lock_in_end_date || ''} onChange={e => handleFieldChange('lock_in_end_date', e.target.value)} className="input-std" />
                                    {caseData.lock_in_end_date ? new Date(caseData.lock_in_end_date).toLocaleDateString() : <span className="text-slate-400">—</span>}
                                </GridField>
                            </>
                        ) : (
                            <GridField label="Loan Amount" isEditing={isEditing}>
                                <PrefixInput prefix="$" value={caseData.loan_size?.toString() || ''} onChange={v => handleFieldChange('loan_size', v ? parseFloat(v) : null)} type="number" />
                                {caseData.loan_size ? `$${caseData.loan_size.toLocaleString()}` : <span className="text-slate-400">—</span>}
                            </GridField>
                        )}
                    </SectionCard>

                    {/* Workflow shortcut */}
                    <div className="card p-5 flex items-center justify-between gap-4">
                        <div>
                            <p className="font-semibold text-slate-800 text-sm">Guided Workflow</p>
                            <p className="text-xs text-slate-500 mt-0.5">Step-by-step fact finding, risk checks, suitability &amp; documents</p>
                        </div>
                        <button
                            onClick={() => setActiveTab('workflow')}
                            className="btn-primary text-sm px-4 py-2 flex items-center gap-2 shrink-0"
                        >
                            <Briefcase size={15} /> Open Workflow
                        </button>
                    </div>
                    </>
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
                        </SectionCard>

                        {/* Follow-up reminder — internal CRM, never on the client-facing workflow */}
                        <FollowUpControl value={caseData.follow_up_date} onSave={handleSetFollowUp} />
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
                        embedded
                        saving={workflowSaving}
                        saved={workflowSaved}
                        currentStage={caseData.stage}
                        onStageAdvance={handleStageChange}
                        onSetFollowUp={handleSetFollowUp}
                        followUpDate={caseData.follow_up_date}
                    />
                ) : caseData.case_type === 'Purchase' ? (
                    <PurchaseWorkflowPanel
                        data={workflowData as PurchaseWorkflow}
                        onChange={handleWorkflowChange}
                        clientName={caseData.client_name}
                        embedded
                        saving={workflowSaving}
                        saved={workflowSaved}
                        hasClientName={!!caseData.client_name?.trim()}
                        onContinue={() => {
                            // Draft → open Overview in edit mode, then the tab effect
                            // scrolls to the client form and focuses the name field.
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

            {/* Tab: Closure */}
            {activeTab === 'closure' && (
                <ClosureTab
                    caseData={caseData}
                    isEditing={isEditing}
                    onFieldChange={handleFieldChange}
                    onSave={handleUpdate}
                    saving={saving}
                />
            )}

            {/* Closed Won Modal */}
            {closedWonOpen && (
                <ClosedWonModal
                    initialData={caseData}
                    onConfirm={details => {
                        setClosedWonOpen(false)
                        handleUpdate({ ...details, stage: 'Closed Won' })
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

// ─── Closure Tab ──────────────────────────────────────────────────────────────

function ClosureTab({ caseData, isEditing, onFieldChange, onSave, saving }: {
    caseData: Case
    isEditing: boolean
    onFieldChange: (f: keyof Case, v: any) => void
    onSave: (u: Partial<Case>) => void
    saving: boolean
}) {
    const isClosedWon = caseData.stage === 'Closed Won'
    const isClosedLost = caseData.stage === 'Closed Lost'

    if (!isClosedWon && !isClosedLost) {
        return (
            <div className="card p-8 text-center space-y-2">
                <FileText size={28} className="mx-auto text-slate-300" />
                <p className="font-semibold text-slate-600">No closure details yet</p>
                <p className="text-sm text-slate-400">This section fills in when the case is closed.</p>
            </div>
        )
    }

    if (isClosedLost) {
        return (
            <div className="card p-6 border border-red-100 bg-red-50/30 space-y-4">
                <div className="flex items-center gap-3 text-red-700">
                    <X size={20} />
                    <h3 className="font-bold text-base">Closed Lost</h3>
                </div>
                <div className="grid grid-cols-1 gap-4">
                    <div>
                        <p className="label-xs">Loss Reason</p>
                        <p className="text-sm font-medium text-slate-800">{caseData.closed_lost_reason || '—'}</p>
                    </div>
                    {caseData.closed_lost_notes && (
                        <div>
                            <p className="label-xs">Notes</p>
                            <p className="text-sm text-slate-700 whitespace-pre-line">{caseData.closed_lost_notes}</p>
                        </div>
                    )}
                </div>
            </div>
        )
    }

    // Closed Won
    return (
        <div className="card p-6 border border-emerald-200 bg-emerald-50/20 space-y-5">
            <div className="flex items-center gap-3 text-emerald-700">
                <CheckCircle2 size={20} />
                <h3 className="font-bold text-base">Closed Won Details</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2">
                    <label className="label-xs">Package Details</label>
                    {isEditing ? (
                        <input type="text" value={caseData.closed_package_details || ''} onChange={e => onFieldChange('closed_package_details', e.target.value)} placeholder="e.g. 2-Year Fixed @ 3.5%" className="input-std" />
                    ) : (
                        <p className="text-sm font-medium text-slate-800">{caseData.closed_package_details || '—'}</p>
                    )}
                </div>
                <div>
                    <label className="label-xs">Interest Rate (%)</label>
                    {isEditing ? (
                        <input type="number" step="0.01" value={caseData.closed_interest_rate || ''} onChange={e => onFieldChange('closed_interest_rate', e.target.value ? parseFloat(e.target.value) : null)} className="input-std" />
                    ) : (
                        <p className="text-sm font-medium text-slate-800">{caseData.closed_interest_rate ? `${caseData.closed_interest_rate}%` : '—'}</p>
                    )}
                </div>
                <div>
                    <label className="label-xs">Tenure (Years)</label>
                    {isEditing ? (
                        <input type="number" value={caseData.closed_tenure || ''} onChange={e => onFieldChange('closed_tenure', e.target.value ? parseInt(e.target.value) : null)} className="input-std" />
                    ) : (
                        <p className="text-sm font-medium text-slate-800">{caseData.closed_tenure ? `${caseData.closed_tenure} years` : '—'}</p>
                    )}
                </div>
                <div>
                    <label className="label-xs">Subsidy Provided</label>
                    {isEditing ? (
                        <input type="text" value={caseData.subsidy_provided || ''} onChange={e => onFieldChange('subsidy_provided', e.target.value)} placeholder="e.g. $2,000" className="input-std" />
                    ) : (
                        <p className="text-sm font-medium text-slate-800">{caseData.subsidy_provided || '—'}</p>
                    )}
                </div>
                <div>
                    <label className="label-xs">Clawback End Date</label>
                    {isEditing ? (
                        <input type="date" value={caseData.clawback_end_date || ''} onChange={e => onFieldChange('clawback_end_date', e.target.value)} className="input-std" />
                    ) : (
                        <p className="text-sm font-medium text-slate-800">{caseData.clawback_end_date ? new Date(caseData.clawback_end_date).toLocaleDateString() : '—'}</p>
                    )}
                </div>
                <div className="sm:col-span-2">
                    <label className="label-xs">Remarks</label>
                    {isEditing ? (
                        <textarea rows={3} value={caseData.remarks || ''} onChange={e => onFieldChange('remarks', e.target.value)} className="input-std font-inherit" style={{ fontFamily: 'inherit', resize: 'vertical' }} />
                    ) : (
                        <p className="text-sm text-slate-700 whitespace-pre-line">{caseData.remarks || '—'}</p>
                    )}
                </div>
            </div>
            {isEditing && (
                <button
                    onClick={() => onSave({
                        closed_package_details: caseData.closed_package_details,
                        closed_interest_rate: caseData.closed_interest_rate,
                        closed_tenure: caseData.closed_tenure,
                        subsidy_provided: caseData.subsidy_provided,
                        clawback_end_date: caseData.clawback_end_date,
                        remarks: caseData.remarks,
                    })}
                    disabled={saving}
                    className="btn-primary text-sm px-5 py-2.5 flex items-center gap-2 w-fit"
                >
                    {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Save size={15} /> Save Closure Details</>}
                </button>
            )}
        </div>
    )
}

// ─── Closed Won Modal ─────────────────────────────────────────────────────────

function ClosedWonModal({ initialData, onConfirm, onCancel }: {
    initialData: Partial<Case>
    onConfirm: (details: Partial<Case>) => void
    onCancel: () => void
}) {
    const [details, setDetails] = useState({
        client_name: initialData.client_name || '',
        client_mobile: initialData.client_mobile || '',
        client_email: initialData.client_email || '',
        closed_package_details: initialData.closed_package_details || '',
        closed_interest_rate: initialData.closed_interest_rate?.toString() || '',
        closed_tenure: initialData.closed_tenure?.toString() || '',
        subsidy_provided: initialData.subsidy_provided || '',
        clawback_end_date: initialData.clawback_end_date || '',
        remarks: initialData.remarks || '',
    })

    return (
        <ModalOverlay>
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <CheckCircle2 size={22} className="text-emerald-600" />
                </div>
                <div>
                    <h2 className="text-lg font-bold text-[#052d4a]">Closed Won Details</h2>
                    <p className="text-sm text-slate-500">Confirm the client and loan package to close this case.</p>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                    <label className="label-xs">Client Name *</label>
                    <input required type="text" value={details.client_name} onChange={e => setDetails(d => ({ ...d, client_name: e.target.value }))} placeholder="e.g. John Tan" className="input-std" autoFocus />
                </div>
                <div>
                    <label className="label-xs">Mobile</label>
                    <input type="tel" value={details.client_mobile} onChange={e => setDetails(d => ({ ...d, client_mobile: e.target.value }))} placeholder="+65 9123 4567" className="input-std" />
                </div>
                <div>
                    <label className="label-xs">Email</label>
                    <input type="email" value={details.client_email} onChange={e => setDetails(d => ({ ...d, client_email: e.target.value }))} placeholder="client@email.com" className="input-std" />
                </div>
                <div className="sm:col-span-2">
                    <label className="label-xs">Package Details *</label>
                    <input required type="text" value={details.closed_package_details} onChange={e => setDetails(d => ({ ...d, closed_package_details: e.target.value }))} placeholder="e.g. 2-Year Fixed @ 3.5%" className="input-std" />
                </div>
                <div>
                    <label className="label-xs">Interest Rate (%)</label>
                    <input type="number" step="0.01" value={details.closed_interest_rate} onChange={e => setDetails(d => ({ ...d, closed_interest_rate: e.target.value }))} className="input-std" />
                </div>
                <div>
                    <label className="label-xs">Tenure (Years)</label>
                    <input type="number" value={details.closed_tenure} onChange={e => setDetails(d => ({ ...d, closed_tenure: e.target.value }))} className="input-std" />
                </div>
                <div>
                    <label className="label-xs">Subsidy Provided</label>
                    <input type="text" value={details.subsidy_provided} onChange={e => setDetails(d => ({ ...d, subsidy_provided: e.target.value }))} placeholder="e.g. $2,000" className="input-std" />
                </div>
                <div>
                    <label className="label-xs">Clawback End Date</label>
                    <input type="date" value={details.clawback_end_date} onChange={e => setDetails(d => ({ ...d, clawback_end_date: e.target.value }))} className="input-std" />
                </div>
                <div className="sm:col-span-2">
                    <label className="label-xs">Remarks</label>
                    <textarea rows={3} value={details.remarks} onChange={e => setDetails(d => ({ ...d, remarks: e.target.value }))} className="input-std" style={{ fontFamily: 'inherit', resize: 'vertical' }} />
                </div>
            </div>
            <div className="flex gap-3 mt-6">
                <button onClick={onCancel} className="btn-ghost flex-1 justify-center py-2.5 text-sm">Cancel</button>
                <button
                    disabled={!details.closed_package_details.trim() || !details.client_name.trim()}
                    onClick={() => onConfirm({
                        client_name: details.client_name.trim(),
                        client_mobile: details.client_mobile.trim() || undefined,
                        client_email: details.client_email.trim() || undefined,
                        closed_package_details: details.closed_package_details,
                        closed_interest_rate: details.closed_interest_rate ? parseFloat(details.closed_interest_rate) : undefined,
                        closed_tenure: details.closed_tenure ? parseInt(details.closed_tenure) : undefined,
                        subsidy_provided: details.subsidy_provided || undefined,
                        clawback_end_date: details.clawback_end_date || undefined,
                        remarks: details.remarks || undefined,
                    })}
                    className="btn-primary flex-2 py-2.5 text-sm flex items-center gap-2 justify-center"
                    style={{ flex: 2, background: '#166534', borderColor: '#166534' }}
                >
                    <CheckCircle2 size={16} /> Save &amp; Close Won
                </button>
            </div>
        </ModalOverlay>
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

function PrefixInput({ prefix, value, onChange, type = 'text' }: { prefix: string; value: string; onChange: (v: string) => void; type?: string }) {
    return (
        <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">{prefix}</span>
            <input type={type} value={value} onChange={e => onChange(e.target.value)} className="input-std pl-7" />
        </div>
    )
}

// ─── Follow-up reminder (internal CRM) ────────────────────────────────────────
// Lives on the Overview tab, never inside the client-facing Workflow tab.
function FollowUpControl({ value, onSave }: { value?: string; onSave: (date: string) => void }) {
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
                    disabled={!date}
                    onClick={() => onSave(date)}
                    className="btn-primary text-sm px-4 py-2 disabled:opacity-40"
                >
                    Set reminder
                </button>
                {value && (
                    <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 size={13} /> Saved · {new Date(value).toLocaleDateString()}
                    </span>
                )}
            </div>
        </div>
    )
}
