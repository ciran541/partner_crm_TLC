'use client'

import { useCallback, useRef, useState } from 'react'
import {
    RefinancingWorkflow as RefinancingWorkflowData,
    RefinancingStepKey,
    REFINANCING_STEP_META,
    computeRefinancingFlags,
    isStepComplete,
    getCurrentStep,
} from '@/lib/types/workflow'
import { WorkflowStepShell, StageAdvancePrompt, FlagBanners } from './WorkflowStep'
import NextActionBanner from './NextActionBanner'
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
import { CheckCircle2, Save } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'

interface Props {
    data: RefinancingWorkflowData
    onChange: (updated: RefinancingWorkflowData) => void
    saving: boolean
    saved: boolean
    onSave: () => void
    onStageAdvance: (toStage: string) => void
    currentPipelineStage: string
}

export default function RefinancingWorkflowPanel({
    data, onChange, saving, saved, onSave, onStageAdvance, currentPipelineStage,
}: Props) {
    const [activeStep, setActiveStep] = useState<RefinancingStepKey>(() => getCurrentStep(data))
    const [stageSuggestion, setStageSuggestion] = useState<{ from: string; to: string } | null>(null)

    const completed = data.completed_steps ?? []
    const flags = computeRefinancingFlags(data)
    const completedCount = completed.length

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

    const markComplete = (step: RefinancingStepKey) => {
        if (completed.includes(step)) return
        const newCompleted = [...completed, step]
        const updated = { ...data, completed_steps: newCompleted, flags: computeRefinancingFlags(data) }
        onChange(updated)

        // Suggest stage advance if this step has one and we're not already there
        const meta = REFINANCING_STEP_META.find(s => s.key === step)
        if (meta?.suggestStageTo && meta.suggestStageTo !== currentPipelineStage) {
            setStageSuggestion({ from: currentPipelineStage, to: meta.suggestStageTo })
        }

        // Auto-advance to next step
        const allKeys = REFINANCING_STEP_META.map(s => s.key)
        const nextKey = allKeys.find(k => k !== step && !newCompleted.includes(k))
        if (nextKey) setActiveStep(nextKey)
    }

    const markIncomplete = (step: RefinancingStepKey) => {
        onChange({ ...data, completed_steps: completed.filter(s => s !== step) })
        setStageSuggestion(null)
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
    const rs = data.risk_suitability ?? {}
    const rp = data.research_proposal ?? {}
    const pp = data.present_proposal ?? {}
    const cd = data.collect_documents ?? {}
    const sb = data.submit_bank ?? {}
    const fa = data.followup_approval ?? {}
    const lo = data.letter_offer ?? {}
    const cr = data.close_retention ?? {}

    return (
        <div className="space-y-4">
            {/* Save bar */}
            <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">Changes auto-save. Use the button to save immediately.</p>
                <div className="flex items-center gap-2">
                    {saving && <span className="text-xs text-slate-400 flex items-center gap-1"><Spinner size="sm" color="#94a3b8" /> Saving…</span>}
                    {saved && !saving && <span className="text-xs text-emerald-600 flex items-center gap-1.5"><CheckCircle2 size={12} /> Saved</span>}
                    <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#052d4a] text-white text-xs font-semibold hover:bg-[#0f4a75] transition-colors">
                        <Save size={13} /> Save
                    </button>
                </div>
            </div>

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
                    onConfirm={() => { onStageAdvance(stageSuggestion.to); setStageSuggestion(null) }}
                    onDismiss={() => setStageSuggestion(null)}
                />
            )}

            {/* Steps */}
            <div className="space-y-2">
                {REFINANCING_STEP_META.map(meta => {
                    const complete = isStepComplete(data, meta.key)
                    const locked = isLocked(meta.key)
                    const active = activeStep === meta.key

                    const stepFlags: { label: string; severity: 'warning' | 'info' }[] = []
                    if (meta.key === 'qualify' && flags.urgent_lock_in) stepFlags.push({ label: 'Urgent lock-in', severity: 'warning' })
                    if (meta.key === 'fact_find' && flags.clawback_risk) stepFlags.push({ label: 'Clawback', severity: 'warning' })
                    if (meta.key === 'risk_suitability') {
                        if (flags.selling_risk) stepFlags.push({ label: 'Selling risk', severity: 'warning' })
                        if (flags.income_risk) stepFlags.push({ label: 'Income risk', severity: 'warning' })
                        if (flags.tdsr_concern) stepFlags.push({ label: 'TDSR concern', severity: 'warning' })
                    }

                    return (
                        <WorkflowStepShell
                            key={meta.key}
                            stepNumber={meta.stepNumber}
                            title={meta.title}
                            isComplete={complete}
                            isLocked={locked}
                            isActive={active}
                            onActivate={() => !locked && setActiveStep(meta.key)}
                            flags={stepFlags}
                        >
                            {meta.key === 'qualify' && (
                                <Step1Qualify data={q} onChange={p => handleStepChange('qualify', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'fact_find' && (
                                <Step2FactFind data={ff} onChange={p => handleStepChange('fact_find', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'risk_suitability' && (
                                <Step3RiskSuitability data={rs} factFind={ff} onChange={p => handleStepChange('risk_suitability', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'research_proposal' && (
                                <Step4ResearchProposal data={rp} qualify={q} factFind={ff} onChange={p => handleStepChange('research_proposal', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'present_proposal' && (
                                <Step5PresentProposal data={pp} onChange={p => handleStepChange('present_proposal', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'collect_documents' && (
                                <Step6CollectDocuments data={cd} factFind={ff} onChange={p => handleStepChange('collect_documents', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'submit_bank' && (
                                <Step7SubmitBank data={sb} onChange={p => handleStepChange('submit_bank', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'followup_approval' && (
                                <Step8FollowupApproval data={fa} onChange={p => handleStepChange('followup_approval', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'letter_offer' && (
                                <Step9LetterOffer data={lo} onChange={p => handleStepChange('letter_offer', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                            {meta.key === 'close_retention' && (
                                <Step10CloseRetention data={cr} onChange={p => handleStepChange('close_retention', p)}
                                    isComplete={complete} onMarkComplete={() => markComplete(meta.key)} onMarkIncomplete={() => markIncomplete(meta.key)} />
                            )}
                        </WorkflowStepShell>
                    )
                })}
            </div>

            {completedCount === 10 && (
                <div className="card p-5 border border-emerald-200 bg-emerald-50/30 text-center space-y-2">
                    <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
                    <p className="font-bold text-emerald-800">All 10 steps complete!</p>
                    <p className="text-sm text-emerald-700">Go to the <strong>Closure</strong> tab to mark this case as Closed Won.</p>
                </div>
            )}
        </div>
    )
}
