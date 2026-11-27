'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react'

export interface ConfirmOptions {
    title: string
    message?: ReactNode
    /** Default "Confirm". Say what happens: "Delete", "Publish 12", "Discard changes". */
    confirmLabel?: string
    cancelLabel?: string
    /** danger: red, for deleting or undoing. warn: amber, for losing unsaved work. primary: for go-ahead actions. */
    tone?: 'danger' | 'warn' | 'primary'
}

/**
 * HUB's confirm dialog: use instead of the browser's confirm(), which shows the
 * site address and can't match the app.
 *
 *     if (!(await askConfirm({ title: 'Delete this draft?', confirmLabel: 'Delete', tone: 'danger' }))) return
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise(resolve => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const root = createRoot(host)
        const done = (ok: boolean) => {
            root.unmount()
            host.remove()
            resolve(ok)
        }
        root.render(<ConfirmDialog {...options} onDone={done} />)
    })
}

const TONE = {
    danger: { icon: Trash2, ring: 'bg-red-50 text-red-600', button: 'bg-red-600 hover:bg-red-700' },
    warn: { icon: AlertTriangle, ring: 'bg-amber-50 text-amber-600', button: 'bg-amber-600 hover:bg-amber-700' },
    primary: { icon: CheckCircle2, ring: 'bg-emerald-50 text-emerald-600', button: 'bg-[#052d4a] hover:bg-[#0a3d62]' },
}

function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', onDone }: ConfirmOptions & { onDone: (ok: boolean) => void }) {
    const cancelRef = useRef<HTMLButtonElement>(null)
    const okRef = useRef<HTMLButtonElement>(null)
    const t = TONE[tone]

    useEffect(() => {
        // Risky actions start on Cancel, so a stray Enter never deletes anything.
        ;(tone === 'primary' ? okRef : cancelRef).current?.focus()
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.stopPropagation(); onDone(false) }
            if (e.key === 'Tab') {
                e.preventDefault()
                ;(document.activeElement === okRef.current ? cancelRef : okRef).current?.focus()
            }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [tone, onDone])

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}
            onMouseDown={e => { if (e.target === e.currentTarget) onDone(false) }}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="hub-confirm-title" className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6">
                <div className="flex gap-4">
                    <span className={`w-11 h-11 shrink-0 rounded-full grid place-items-center ${t.ring}`}><t.icon size={20} /></span>
                    <div className="min-w-0 pt-1">
                        <p id="hub-confirm-title" className="text-[17px] font-bold text-[#052d4a] leading-snug">{title}</p>
                        {message && <div className="text-sm text-slate-600 mt-1.5 leading-relaxed">{message}</div>}
                    </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                    <button ref={cancelRef} onClick={() => onDone(false)} className="min-h-12 px-5 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-100">{cancelLabel}</button>
                    <button ref={okRef} onClick={() => onDone(true)} className={`min-h-12 px-5 rounded-full text-sm font-semibold text-white ${t.button}`}>{confirmLabel}</button>
                </div>
            </div>
        </div>
    )
}
