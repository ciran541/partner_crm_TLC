'use client'

import { ReactNode, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, AlertTriangle, Info, Lightbulb, BookOpen } from 'lucide-react'

// ─── Step wrapper ─────────────────────────────────────────────────────────────

interface WorkflowStepProps {
    stepNumber: number
    title: string
    isComplete: boolean
    isLocked: boolean
    isActive: boolean
    onActivate: () => void
    children: ReactNode
    flags?: { label: string; severity: 'warning' | 'info' }[]
}

export function WorkflowStepShell({
    stepNumber, title, isComplete, isLocked, isActive, onActivate, children, flags = [],
}: WorkflowStepProps) {
    return (
        <div className={`rounded-xl border transition-all ${
            isLocked ? 'border-slate-100 bg-slate-50/50 opacity-60'
            : isActive ? 'border-[#03a9e7] shadow-sm bg-white'
            : isComplete ? 'border-emerald-200 bg-emerald-50/20'
            : 'border-slate-200 bg-white'
        }`}>
            <button
                type="button"
                disabled={isLocked}
                onClick={onActivate}
                className="w-full flex items-center gap-3 p-4 text-left rounded-xl transition-colors disabled:cursor-not-allowed hover:bg-slate-50/60"
            >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    isComplete ? 'bg-emerald-500 text-white'
                    : isActive ? 'bg-[#03a9e7] text-white'
                    : isLocked ? 'bg-slate-200 text-slate-400'
                    : 'bg-slate-100 text-slate-500'
                }`}>
                    {isComplete ? <CheckCircle2 size={16} /> : stepNumber}
                </div>
                <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${
                        isComplete ? 'text-emerald-800' : isLocked ? 'text-slate-400' : 'text-slate-800'
                    }`}>{title}</p>
                    {flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                            {flags.map((f, i) => (
                                <span key={i} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                                    f.severity === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-100'
                                }`}>
                                    {f.severity === 'warning' ? '⚠' : 'ℹ'} {f.label}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                {!isLocked && (
                    <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${isActive ? 'rotate-180' : ''}`} />
                )}
            </button>
            {isActive && !isLocked && (
                <div className="px-5 pb-6 border-t border-slate-100">
                    {children}
                </div>
            )}
        </div>
    )
}

// ─── Expandable card (script hints / knowledge cards) ─────────────────────────

interface ExpandableCardProps {
    title: string
    variant: 'script' | 'knowledge'
    children: ReactNode
}

export function ExpandableCard({ title, variant, children }: ExpandableCardProps) {
    const [open, setOpen] = useState(false)
    const isScript = variant === 'script'
    return (
        <div className={`rounded-lg border ${isScript ? 'border-violet-200 bg-violet-50/40' : 'border-blue-200 bg-blue-50/30'}`}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
            >
                {isScript
                    ? <Lightbulb size={14} className="text-violet-600 shrink-0" />
                    : <BookOpen size={14} className="text-blue-600 shrink-0" />
                }
                <span className={`text-xs font-semibold flex-1 ${isScript ? 'text-violet-700' : 'text-blue-700'}`}>{title}</span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className={`px-4 pb-4 text-xs leading-relaxed border-t ${
                    isScript ? 'border-violet-100 text-violet-900' : 'border-blue-100 text-blue-900'
                } whitespace-pre-line`}>
                    {children}
                </div>
            )}
        </div>
    )
}

// ─── Stage advance prompt ─────────────────────────────────────────────────────

interface StageAdvancePromptProps {
    fromStage: string
    toStage: string
    onConfirm: () => void
    onDismiss: () => void
}

export function StageAdvancePrompt({ fromStage, toStage, onConfirm, onDismiss }: StageAdvancePromptProps) {
    return (
        <div className="mt-4 rounded-xl border border-[#03a9e7]/40 bg-sky-50/60 p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-sm font-semibold text-[#052d4a]">Ready to advance the pipeline?</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                        <span className="font-medium text-slate-600">{fromStage}</span>
                        <span className="mx-1.5 text-slate-400">→</span>
                        <span className="font-medium text-[#03a9e7]">{toStage}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={onDismiss} className="text-xs text-slate-400 hover:text-slate-600 font-medium">
                        Not yet
                    </button>
                    <button type="button" onClick={onConfirm} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#03a9e7] text-white hover:bg-[#0284c7] transition-colors">
                        Advance →
                    </button>
                </div>
            </div>
        </div>
    )
}

// ─── Action list ──────────────────────────────────────────────────────────────

export function ActionList({ actions }: { actions: string[] }) {
    return (
        <ol className="space-y-2 my-4">
            {actions.map((action, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-slate-700">
                    <span className="w-5 h-5 rounded-full bg-[#052d4a] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                    </span>
                    <span className="leading-relaxed">{action}</span>
                </li>
            ))}
        </ol>
    )
}

// ─── Step complete/incomplete buttons ─────────────────────────────────────────

interface StepActionsProps {
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
    completionLabel?: string
}

export function StepActions({ isComplete, onMarkComplete, onMarkIncomplete, completionLabel = 'Mark step complete' }: StepActionsProps) {
    return (
        <div className="flex items-center gap-3 pt-4 border-t border-slate-100 mt-5">
            {isComplete ? (
                <button type="button" onClick={onMarkIncomplete}
                    className="flex items-center gap-2 text-sm text-emerald-700 font-medium hover:text-emerald-900 transition-colors">
                    <CheckCircle2 size={16} className="text-emerald-500" />
                    Step complete — undo
                </button>
            ) : (
                <button type="button" onClick={onMarkComplete}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors">
                    <CheckCircle2 size={15} />
                    {completionLabel}
                </button>
            )}
        </div>
    )
}

// ─── Field primitives ─────────────────────────────────────────────────────────

interface QuestionProps { label: string; required?: boolean; children: ReactNode }
export function Question({ label, required, children }: QuestionProps) {
    return (
        <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
                {label}{required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            {children}
        </div>
    )
}

interface RadioGroupProps {
    value: string | undefined
    onChange: (v: string) => void
    options: { value: string; label: string }[]
}
export function RadioGroup({ value, onChange, options }: RadioGroupProps) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(opt => (
                <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                        value === opt.value
                            ? 'bg-[#052d4a] border-[#052d4a] text-white'
                            : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                    }`}>
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

interface CheckItemProps { checked?: boolean; onChange: (v: boolean) => void; label: string; hint?: string }
export function CheckItem({ checked, onChange, label, hint }: CheckItemProps) {
    return (
        <label className="flex items-start gap-3 cursor-pointer group py-1">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${
                checked ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 group-hover:border-emerald-400'
            }`} onClick={() => onChange(!checked)}>
                {checked && <svg width="11" height="8" viewBox="0 0 11 8" fill="none"><path d="M1 3.5L4 6.5L10 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
            <div>
                <span className={`text-sm font-medium ${checked ? 'text-emerald-800' : 'text-slate-700'}`}>{label}</span>
                {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
            </div>
        </label>
    )
}

interface FieldInputProps { value?: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; prefix?: string; suffix?: string; commas?: boolean }
export function FieldInput({ value, onChange, placeholder, type = 'text', prefix, suffix, commas }: FieldInputProps) {
    const inputRef = useRef<HTMLInputElement>(null)

    let displayValue: string
    if (commas) {
        const raw = value !== undefined && value !== '' ? String(value).replace(/,/g, '') : ''
        const n = raw !== '' ? parseFloat(raw) : NaN
        displayValue = !isNaN(n) ? n.toLocaleString() : raw
    } else {
        displayValue = value !== undefined ? String(value) : ''
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!commas) { onChange(e.target.value); return }
        const el = e.target
        const stripped = el.value.replace(/,/g, '')
        // preserve cursor position relative to digits (commas shift the offset)
        const cursorFromEnd = el.value.length - (el.selectionEnd ?? el.value.length)
        onChange(stripped)
        // restore cursor after React re-render
        requestAnimationFrame(() => {
            if (!inputRef.current) return
            const newLen = inputRef.current.value.length
            const pos = Math.max(0, newLen - cursorFromEnd)
            inputRef.current.setSelectionRange(pos, pos)
        })
    }

    return (
        <div className="relative">
            {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">{prefix}</span>}
            <input
                ref={inputRef}
                type={commas ? 'text' : type}
                inputMode={commas ? 'numeric' : undefined}
                value={displayValue}
                onChange={handleChange}
                placeholder={placeholder}
                className={`w-full py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all ${prefix ? 'pl-7 pr-3' : suffix ? 'pl-3 pr-8' : 'px-3'}`}
            />
            {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">{suffix}</span>}
        </div>
    )
}

export function FieldTextarea({ value, onChange, placeholder, rows = 3 }: { value?: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
    return (
        <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={rows}
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all resize-none" style={{ fontFamily: 'inherit' }} />
    )
}

// ─── Flag banners ─────────────────────────────────────────────────────────────

export function FlagBanners({ flags }: { flags: { key: string; label: string; description: string }[] }) {
    if (!flags.length) return null
    return (
        <div className="space-y-2 mb-4">
            {flags.map(f => (
                <div key={f.key} className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                    <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-semibold text-amber-800">{f.label}</p>
                        <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">{f.description}</p>
                    </div>
                </div>
            ))}
        </div>
    )
}
