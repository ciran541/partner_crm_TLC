'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    RefinancingWorkflow as RefinancingWorkflowData,
    RefinancingStepKey,
    REFINANCING_STEP_META,
    computeRefinancingFlags,
    isStepComplete,
    getCurrentStep,
} from '@/lib/types/workflow'
import type { Case } from '@/lib/types'
import { validateRefinancingStep } from '@/lib/insurance/workflowValidation'
import { StageAdvancePrompt, FlagBanners } from './WorkflowStep'
import NextActionBanner from './NextActionBanner'
import ContextualKnowledge from '@/components/insurance/knowledge/ContextualKnowledge'
import KnowledgeAsk from '@/components/insurance/knowledge/KnowledgeAsk'
import Step1Qualify from './steps/Step1Qualify'
import Step2FactFind from './steps/Step2FactFind'
import Step3RiskSuitability from './steps/Step3RiskSuitability'
import Step4ResearchProposal from './steps/Step4ResearchProposal'
import Step5PresentProposal from './steps/Step5PresentProposal'
import Step6CollectDocuments from './steps/Step6CollectDocuments'
import Step7SubmitBank from './steps/Step7SubmitBank'
import Step8FollowupApproval from './steps/Step8FollowupApproval'
import Step9LetterOffer from './steps/Step9LetterOffer'
import Step10CloseRetention from './steps/Step10CloseRetention'
import { CheckCircle2, Save, ChevronLeft, ChevronRight, BookOpen, X } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'

interface Props {
    data: RefinancingWorkflowData
    caseData: Case
    onChange: (updated: RefinancingWorkflowData) => void
    saving: boolean
    saved: boolean
    onSave: () => void
    onStageAdvance: (toStage: string) => void
    currentPipelineStage: string
}

export default function RefinancingWorkflowPanel({
    data, caseData, onChange, saving, saved, onSave, onStageAdvance, currentPipelineStage,
}: Props) {
    const [activeStep, setActiveStep] = useState<RefinancingStepKey>(() => getCurrentStep(data))
    const [dismissedStage, setDismissedStage] = useState<string | null>(null)
    const [validation, setValidation] = useState<{ step: RefinancingStepKey; errors: string[]; warnings: string[] } | null>(null)
    const [searchOpen, setSearchOpen] = useState(false)
    const autoPopulated = useRef(false)

    // Pipeline stage order for forward-only advancement checks
    const STAGE_ORDER: Record<string, number> = {
        'Touched Base': 0, 'Proposal Given': 1, 'Referred to Bank': 2,
        'Pending Approval': 3, 'Pending Signature': 4, 'Closed Won': 5, 'Closed Lost': 6,
    }

    // Derived — computed from completed steps vs current stage.
    // Persists across tab switches and page reloads. Only shows if moving forward.
    const stageSuggestion = useMemo<{ from: string; to: string } | null>(() => {
        const currentIdx = STAGE_ORDER[currentPipelineStage] ?? 0
        let best: { from: string; to: string } | null = null

        for (const key of (data.completed_steps ?? [])) {
            const meta = REFINANCING_STEP_META.find(s => s.key === key)
            if (!meta?.suggestStageTo) continue
            const suggestIdx = STAGE_ORDER[meta.suggestStageTo] ?? 0
            // Only forward moves; pick the furthest suggestion
            if (suggestIdx > currentIdx && (!best || suggestIdx > (STAGE_ORDER[best.to] ?? 0))) {
                best = { from: currentPipelineStage, to: meta.suggestStageTo }
            }
        }
        // Hide if the agent dismissed this exact target
        if (best && best.to === dismissedStage) return null
        return best
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.completed_steps, currentPipelineStage, dismissedStage])

    // On first load, pre-populate Step 1 from case data if those fields are empty
    useEffect(() => {
        if (autoPopulated.current) return
        autoPopulated.current = true

        const q = data.qualify ?? {}
        const patch: Partial<typeof q> = {}

        if (!q.current_bank && caseData.current_bank)
            patch.current_bank = caseData.current_bank
        if (!q.outstanding_loan && caseData.existing_loan_amount)
            patch.outstanding_loan = caseData.existing_loan_amount
        if (!q.lock_in_expiry && caseData.lock_in_end_date) {
            patch.lock_in_expiry = caseData.lock_in_end_date
            patch.lock_in_status = 'in_lock_in'
        }
        if (!q.rough_monthly_payment && (q.outstanding_loan || caseData.existing_loan_amount)) {
            // Leave payment blank — agent should confirm with client
        }

        if (Object.keys(patch).length > 0) {
            onChange({ ...data, qualify: { ...q, ...patch } })
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const completed = data.completed_steps ?? []
    const flags = computeRefinancingFlags(data)
    const completedCount = completed.length

    // Clear any validation panel when the visible step changes
    useEffect(() => { setValidation(null) }, [activeStep])

    const handleStepChange = useCallback(<T,>(
        stepKey: keyof RefinancingWorkflowData,
        patch: Partial<T>
    ) => {
        const updated = {
            ...data,
            [stepKey]: { ...(data[stepKey] as object ?? {}), ...patch },
        }
        updated.flags = computeRefinancingFlags(updated)
        onChange(updated)
    }, [data, onChange])

    // Verification: validate the step before allowing completion.
    // Errors block; warnings require an explicit "Complete anyway".
    const markComplete = (step: RefinancingStepKey) => {
        if (completed.includes(step)) return
        const v = validateRefinancingStep(step, data)
        if (v.errors.length > 0 || v.warnings.length > 0) {
            setValidation({ step, errors: v.errors, warnings: v.warnings })
            return
        }
        doComplete(step)
    }

    const doComplete = (step: RefinancingStepKey) => {
        setValidation(null)
        if (completed.includes(step)) return
        const newCompleted = [...completed, step]
        const updated = { ...data, completed_steps: newCompleted, flags: computeRefinancingFlags(data) }
        onChange(updated)

        // Stage-advance suggestion is derived from completed_steps (see stageSuggestion useMemo)

        // Auto-advance to next step
        const allKeys = REFINANCING_STEP_META.map(s => s.key)
        const nextKey = allKeys.find(k => k !== step && !newCompleted.includes(k))
        if (nextKey) setActiveStep(nextKey)
    }

    const markIncomplete = (step: RefinancingStepKey) => {
        setValidation(null)
        onChange({ ...data, completed_steps: completed.filter(s => s !== step) })
    }

    const isLocked = (step: RefinancingStepKey) => {
        const meta = REFINANCING_STEP_META.find(s => s.key === step)
        if (!meta || meta.stepNumber === 1) return false
        const prevKey = REFINANCING_STEP_META[meta.stepNumber - 2].key
        return !completed.includes(prevKey)
    }

    const activeFlagBanners = [
        flags.urgent_lock_in && { key: 'urgent_lock_in', label: '⚡ Urgent: Lock-in Expiring Soon', description: 'Lock-in expires within 90 days. Prioritise rate comparison and bank submission immediately to avoid missing the window.' },
        flags.clawback_risk && { key: 'clawback_risk', label: '⚠ Clawback Risk', description: 'Client received a subsidy with remaining clawback. Factor this into the net savings calculation before recommending refinancing.' },
        flags.selling_risk && { key: 'selling_risk', label: '⚠ Selling Risk', description: 'Client may sell the property. Recommend shortest possible lock-in — or reconsider refinancing if selling very soon.' },
        flags.income_risk && { key: 'income_risk', label: '⚠ Income Change Expected', description: 'Anticipated income changes may affect loan serviceability. Verify TDSR compliance with the projected income level.' },
        flags.tdsr_concern && { key: 'tdsr_concern', label: '⚠ TDSR Concern', description: 'Computed TDSR is approaching 45%. Verify the new mortgage payment keeps total debt obligations within the 55% cap.' },
    ].filter(Boolean) as { key: string; label: string; description: string }[]

    const q = data.qualify ?? {}
    const ff = data.fact_find ?? {}

    // Pre-fill Step 2 (fact_find) from Step 1 (qualify) for overlapping package fields.
    // Only fills in if the Step 2 field is still empty — explicit Step 2 entries always win.
    const effectiveFF = {
        ...ff,
        interest_type:      ff.interest_type      ?? q.interest_type,
        fixed_years:        ff.fixed_years        ?? q.fixed_years,
        lock_in_years:      ff.lock_in_years      ?? q.lock_in_years,
        year_rates:         ff.year_rates?.length  ? ff.year_rates : (q.year_rates ?? []),
        floating_rate_type: ff.floating_rate_type ?? q.floating_rate_type,
    }
    const rs = data.risk_suitability ?? {}
    const rp = data.research_proposal ?? {}
    const pp = data.present_proposal ?? {}
    const cd = data.collect_documents ?? {}
    const sb = data.submit_bank ?? {}
    const fa = data.followup_approval ?? {}
    const lo = data.letter_offer ?? {}
    const cr = data.close_retention ?? {}

    // Wizard navigation
    const activeIndex = REFINANCING_STEP_META.findIndex(s => s.key === activeStep)
    const activeMeta = REFINANCING_STEP_META[activeIndex]
    const nextMeta = REFINANCING_STEP_META[activeIndex + 1]
    const nextLocked = nextMeta ? isLocked(nextMeta.key) : true
    const goPrev = () => { if (activeIndex > 0) setActiveStep(REFINANCING_STEP_META[activeIndex - 1].key) }
    const goNext = () => { if (nextMeta && !nextLocked) setActiveStep(nextMeta.key) }

    return (
        <div className="space-y-4">
            {/* Save bar */}
            <div className="flex items-center justify-between">
                <button onClick={() => setSearchOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors">
                    <BookOpen size={13} /> Look something up
                </button>
                <div className="flex items-center gap-2">
                    {saving && <span className="text-xs text-slate-400 flex items-center gap-1"><Spinner size="sm" color="#94a3b8" /> Saving…</span>}
                    {saved && !saving && <span className="text-xs text-emerald-600 flex items-center gap-1.5"><CheckCircle2 size={12} /> Saved</span>}
                    <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#052d4a] text-white text-xs font-semibold hover:bg-[#0f4a75] transition-colors">
                        <Save size={13} /> Save
                    </button>
                </div>
            </div>

            {/* Knowledge search overlay */}
            {searchOpen && (
                <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-20" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setSearchOpen(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[75vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <p className="font-bold text-[#052d4a] flex items-center gap-2"><BookOpen size={17} className="text-[#03a9e7]" /> Knowledge Search</p>
                            <button onClick={() => setSearchOpen(false)} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={18} /></button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            <KnowledgeAsk autoFocus />
                        </div>
                    </div>
                </div>
            )}

            {/* Next action banner */}
            <NextActionBanner
                currentStep={getCurrentStep(data)}
                completedCount={completedCount}
                flags={flags}
            />

            {/* Risk flags */}
            <FlagBanners flags={activeFlagBanners} />

            {/* Stage advance prompt */}
            {stageSuggestion && (
                <StageAdvancePrompt
                    fromStage={stageSuggestion.from}
                    toStage={stageSuggestion.to}
                    onConfirm={() => onStageAdvance(stageSuggestion.to)}
                    onDismiss={() => setDismissedStage(stageSuggestion.to)}
                />
            )}

            {/* Step rail — compact clickable navigation */}
            <StepRail
                activeStep={activeStep}
                isComplete={(k) => isStepComplete(data, k)}
                isLocked={isLocked}
                onSelect={(k) => setActiveStep(k)}
            />

            {/* Single active step card (wizard) */}
            <div key={activeStep} className="wf-slide">
                <div className="rounded-xl border border-[#03a9e7]/30 bg-white shadow-sm overflow-hidden">
                    {/* Step header */}
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isStepComplete(data, activeStep) ? 'bg-emerald-500 text-white' : 'bg-[#03a9e7] text-white'
                        }`}>
                            {isStepComplete(data, activeStep) ? <CheckCircle2 size={16} /> : activeMeta?.stepNumber}
                        </div>
                        <div className="min-w-0">
                            <p className="font-semibold text-[#052d4a] text-sm">{activeMeta?.title}</p>
                            <p className="text-[11px] text-slate-400">Step {activeMeta?.stepNumber} of 10</p>
                        </div>
                    </div>

                    {/* Step content */}
                    <div className="px-5 pb-6">
                        {activeStep === 'qualify' && (
                            <Step1Qualify data={q} clientName={caseData.client_name} onChange={p => handleStepChange('qualify', p)}
                                isComplete={isStepComplete(data, 'qualify')} onMarkComplete={() => markComplete('qualify')} onMarkIncomplete={() => markIncomplete('qualify')} />
                        )}
                        {activeStep === 'fact_find' && (
                            <Step2FactFind data={effectiveFF} qualify={q} clientName={caseData.client_name} onChange={p => handleStepChange('fact_find', p)}
                                isComplete={isStepComplete(data, 'fact_find')} onMarkComplete={() => markComplete('fact_find')} onMarkIncomplete={() => markIncomplete('fact_find')} />
                        )}
                        {activeStep === 'risk_suitability' && (
                            <Step3RiskSuitability data={rs} factFind={ff} qualify={q} clientName={caseData.client_name} onChange={p => handleStepChange('risk_suitability', p)}
                                isComplete={isStepComplete(data, 'risk_suitability')} onMarkComplete={() => markComplete('risk_suitability')} onMarkIncomplete={() => markIncomplete('risk_suitability')} />
                        )}
                        {activeStep === 'research_proposal' && (
                            <Step4ResearchProposal data={rp} qualify={q} factFind={ff} risk={rs} clientName={caseData.client_name} onChange={p => handleStepChange('research_proposal', p)}
                                isComplete={isStepComplete(data, 'research_proposal')} onMarkComplete={() => markComplete('research_proposal')} onMarkIncomplete={() => markIncomplete('research_proposal')} />
                        )}
                        {activeStep === 'present_proposal' && (
                            <Step5PresentProposal data={pp} qualify={q} factFind={ff} proposal={rp} clientName={caseData.client_name} onChange={p => handleStepChange('present_proposal', p)}
                                isComplete={isStepComplete(data, 'present_proposal')} onMarkComplete={() => markComplete('present_proposal')} onMarkIncomplete={() => markIncomplete('present_proposal')} />
                        )}
                        {activeStep === 'collect_documents' && (
                            <Step6CollectDocuments data={cd} factFind={ff} onChange={p => handleStepChange('collect_documents', p)}
                                isComplete={isStepComplete(data, 'collect_documents')} onMarkComplete={() => markComplete('collect_documents')} onMarkIncomplete={() => markIncomplete('collect_documents')} />
                        )}
                        {activeStep === 'submit_bank' && (
                            <Step7SubmitBank data={sb} onChange={p => handleStepChange('submit_bank', p)}
                                isComplete={isStepComplete(data, 'submit_bank')} onMarkComplete={() => markComplete('submit_bank')} onMarkIncomplete={() => markIncomplete('submit_bank')} />
                        )}
                        {activeStep === 'followup_approval' && (
                            <Step8FollowupApproval data={fa} onChange={p => handleStepChange('followup_approval', p)}
                                isComplete={isStepComplete(data, 'followup_approval')} onMarkComplete={() => markComplete('followup_approval')} onMarkIncomplete={() => markIncomplete('followup_approval')} />
                        )}
                        {activeStep === 'letter_offer' && (
                            <Step9LetterOffer data={lo} onChange={p => handleStepChange('letter_offer', p)}
                                isComplete={isStepComplete(data, 'letter_offer')} onMarkComplete={() => markComplete('letter_offer')} onMarkIncomplete={() => markIncomplete('letter_offer')} />
                        )}
                        {activeStep === 'close_retention' && (
                            <Step10CloseRetention data={cr} onChange={p => handleStepChange('close_retention', p)}
                                isComplete={isStepComplete(data, 'close_retention')} onMarkComplete={() => markComplete('close_retention')} onMarkIncomplete={() => markIncomplete('close_retention')} />
                        )}

                        {/* Admin-managed knowledge surfaced for this step */}
                        <ContextualKnowledge caseType="Refinancing" step={activeStep} />
                    </div>
                </div>
            </div>

            {/* Verification panel — errors block, warnings need acknowledgement */}
            {validation && validation.step === activeStep && (
                <ValidationPanel
                    errors={validation.errors}
                    warnings={validation.warnings}
                    onConfirm={() => doComplete(validation.step)}
                    onCancel={() => setValidation(null)}
                />
            )}

            {/* Back / Next navigation */}
            <div className="flex items-center justify-between">
                <button
                    type="button"
                    onClick={goPrev}
                    disabled={activeIndex === 0}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    <ChevronLeft size={16} /> Back
                </button>

                <span className="text-xs text-slate-400">{activeMeta?.stepNumber} / 10</span>

                <button
                    type="button"
                    onClick={goNext}
                    disabled={activeIndex === REFINANCING_STEP_META.length - 1 || nextLocked}
                    title={nextLocked ? 'Complete this step to continue' : undefined}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#03a9e7] hover:bg-[#0284c7] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Next <ChevronRight size={16} />
                </button>
            </div>

            {completedCount === 10 && (
                <div className="card p-5 border border-emerald-200 bg-emerald-50/30 text-center space-y-2">
                    <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
                    <p className="font-bold text-emerald-800">All 10 steps complete!</p>
                    <p className="text-sm text-emerald-700">Go to the <strong>Closure</strong> tab to mark this case as Closed Won.</p>
                </div>
            )}

            <style jsx>{`
                .wf-slide {
                    animation: wfSlideIn 0.28s ease-out;
                }
                @keyframes wfSlideIn {
                    from { opacity: 0; transform: translateX(16px); }
                    to   { opacity: 1; transform: translateX(0); }
                }
            `}</style>
        </div>
    )
}

// ─── Verification panel ───────────────────────────────────────────────────────

function ValidationPanel({ errors, warnings, onConfirm, onCancel }: {
    errors: string[]
    warnings: string[]
    onConfirm: () => void
    onCancel: () => void
}) {
    const hasErrors = errors.length > 0
    return (
        <div className={`rounded-xl border p-4 ${hasErrors ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
            {hasErrors && (
                <div className="mb-3">
                    <p className="text-sm font-bold text-red-800 mb-1.5">Fix these before completing:</p>
                    <ul className="space-y-1">
                        {errors.map((e, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                                <span className="text-red-400 mt-0.5 shrink-0">✕</span>{e}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {warnings.length > 0 && (
                <div className={hasErrors ? 'pt-3 border-t border-red-200' : ''}>
                    <p className="text-sm font-bold text-amber-800 mb-1.5">{hasErrors ? 'Also review:' : 'Please review before continuing:'}</p>
                    <ul className="space-y-1">
                        {warnings.map((w, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs text-amber-800">
                                <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>{w}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="flex items-center gap-2 mt-4">
                {hasErrors ? (
                    <button type="button" onClick={onCancel}
                        className="px-4 py-2 rounded-lg bg-white border border-red-200 text-red-700 text-sm font-semibold hover:bg-red-50 transition-colors">
                        Go back and fix
                    </button>
                ) : (
                    <>
                        <button type="button" onClick={onConfirm}
                            className="px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition-colors">
                            Complete anyway
                        </button>
                        <button type="button" onClick={onCancel}
                            className="px-4 py-2 rounded-lg text-slate-500 text-sm font-medium hover:bg-white/60 transition-colors">
                            Go back
                        </button>
                    </>
                )}
            </div>
        </div>
    )
}

// ─── Step rail (compact horizontal stepper) ───────────────────────────────────

function StepRail({ activeStep, isComplete, isLocked, onSelect }: {
    activeStep: RefinancingStepKey
    isComplete: (k: RefinancingStepKey) => boolean
    isLocked: (k: RefinancingStepKey) => boolean
    onSelect: (k: RefinancingStepKey) => void
}) {
    return (
        <div className="flex items-center gap-0 overflow-x-auto pb-1 -mx-1 px-1">
            {REFINANCING_STEP_META.map((meta, i) => {
                const complete = isComplete(meta.key)
                const locked = isLocked(meta.key)
                const active = activeStep === meta.key
                return (
                    <div key={meta.key} className="flex items-center shrink-0">
                        <button
                            type="button"
                            disabled={locked}
                            onClick={() => !locked && onSelect(meta.key)}
                            title={meta.title}
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all shrink-0 ${
                                active ? 'bg-[#03a9e7] text-white ring-2 ring-[#03a9e7]/30 ring-offset-1'
                                : complete ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                                : locked ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                                : 'bg-white border border-slate-300 text-slate-500 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                            }`}
                        >
                            {complete ? <CheckCircle2 size={15} /> : meta.stepNumber}
                        </button>
                        {i < REFINANCING_STEP_META.length - 1 && (
                            <div className={`w-4 sm:w-6 h-0.5 shrink-0 ${complete ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                        )}
                    </div>
                )
            })}
        </div>
    )
}
