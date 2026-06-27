'use client'

import { useEffect, useMemo, useRef } from 'react'
import type { EquityLoanWorkflow } from '@/lib/types/workflow'
import type { SoraRates } from '@/lib/insurance/sora'
import { buildEquityLoanPresentationHtml } from '@/lib/insurance/equityLoanReport'
import { X, Printer, Sparkles } from 'lucide-react'

interface Props {
    clientName?: string
    advisorName?: string
    workflow: EquityLoanWorkflow
    sora?: SoraRates | null
    onClose: () => void
}

// Renders the exact same HTML as the printed/emailed PDF (single source of truth).
export default function EquityLoanPresentation({ clientName, advisorName, workflow, sora, onClose }: Props) {
    const frameRef = useRef<HTMLIFrameElement>(null)

    const html = useMemo(
        () => buildEquityLoanPresentationHtml({ clientName, advisorName, workflow, sora }),
        [clientName, advisorName, workflow, sora],
    )

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
    }, [onClose])

    const print = () => {
        const win = frameRef.current?.contentWindow
        if (!win) return
        win.focus()
        win.print()
    }

    return (
        <div className="fixed inset-0 z-[120] bg-slate-100 flex flex-col">
            <div className="shrink-0 bg-white/90 backdrop-blur border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#052d4a] flex items-center gap-2">
                    <Sparkles size={15} className="text-[#03a9e7]" /> Client presentation
                    <span className="hidden sm:inline text-xs font-normal text-slate-400">— show this to your client</span>
                </p>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={print}
                        className="text-sm px-3 py-1.5 rounded-lg bg-[#052d4a] text-white font-semibold hover:bg-[#063a5e] flex items-center gap-1.5">
                        <Printer size={14} /> <span className="hidden sm:inline">Print / Save PDF</span>
                    </button>
                    <button type="button" onClick={onClose} aria-label="Close presentation"
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                        <X size={20} />
                    </button>
                </div>
            </div>

            <iframe ref={frameRef} srcDoc={html} title="Client presentation" className="flex-1 w-full border-0 bg-slate-100" />
        </div>
    )
}
