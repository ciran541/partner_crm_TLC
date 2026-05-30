'use client'

import { AlertTriangle } from 'lucide-react'
import { RefinancingStepKey, WorkflowFlags, REFINANCING_STEP_META } from '@/lib/types/workflow'

interface Props {
    currentStep: RefinancingStepKey
    completedCount: number
    flags: WorkflowFlags
}

const FLAG_LABELS: { key: keyof WorkflowFlags; label: string }[] = [
    { key: 'urgent_lock_in',  label: '⚡ Urgent Lock-in' },
    { key: 'clawback_risk',   label: '⚠ Clawback Risk' },
    { key: 'selling_risk',    label: '⚠ Selling Risk' },
    { key: 'income_risk',     label: '⚠ Income Risk' },
    { key: 'tdsr_concern',    label: '⚠ TDSR Concern' },
]

export default function NextActionBanner({ currentStep, completedCount, flags }: Props) {
    const meta = REFINANCING_STEP_META.find(s => s.key === currentStep)
    if (!meta) return null

    const activeFlags = FLAG_LABELS.filter(f => flags[f.key])
    const allDone = completedCount === 10

    return (
        <div className="rounded-xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #052d4a 0%, #0f4a75 100%)' }}>
            <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">
                            {allDone ? 'All Steps Complete' : `Step ${meta.stepNumber} of 10`}
                        </span>
                        {/* Progress dots */}
                        <div className="hidden sm:flex items-center gap-0.5 ml-2">
                            {REFINANCING_STEP_META.map((s, i) => (
                                <div key={s.key} className={`h-1 rounded-full transition-all ${
                                    i < completedCount ? 'w-3 bg-emerald-400' :
                                    s.key === currentStep ? 'w-3 bg-[#03a9e7]' :
                                    'w-1.5 bg-white/20'
                                }`} />
                            ))}
                        </div>
                    </div>
                    <span className="text-xs text-white/60">{completedCount}/10 complete</span>
                </div>

                {allDone ? (
                    <p className="text-base font-bold text-white">🎉 Workflow complete — ready to close!</p>
                ) : (
                    <>
                        <p className="text-base font-bold text-white">{meta.title}</p>
                        <p className="text-sm text-white/70 mt-1 leading-relaxed">
                            <span className="text-white/50 font-semibold text-xs uppercase tracking-wide mr-1">Next action:</span>
                            {meta.nextAction}
                        </p>
                    </>
                )}
            </div>

            {activeFlags.length > 0 && (
                <div className="px-5 py-2.5 flex flex-wrap gap-2 border-t border-white/10 bg-amber-500/20">
                    <AlertTriangle size={13} className="text-amber-300 shrink-0 mt-0.5" />
                    {activeFlags.map(f => (
                        <span key={f.key} className="text-xs font-semibold text-amber-200">
                            {f.label}
                        </span>
                    ))}
                </div>
            )}
        </div>
    )
}
