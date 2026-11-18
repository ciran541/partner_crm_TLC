'use client'

import { X } from 'lucide-react'
import { ReactNode, useEffect, useId, useRef } from 'react'

interface ModalProps {
    title: string
    children: ReactNode
    onClose: () => void
    /** Width. Default 'md' (forms with a few fields); 'lg'/'xl' for wide forms and tables. */
    size?: 'md' | 'lg' | 'xl'
}

const SIZE = { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-5xl' } as const

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

/**
 * Shared Modal component.
 * Extracted from /dashboard/users/page.tsx for reuse across admin and property domains.
 */
export default function Modal({ title, children, onClose, size = 'md' }: ModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null)
    const titleId = useId()

    useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null
        const dialog = dialogRef.current
        const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE)
        firstFocusable?.focus()

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose()
                return
            }
            if (e.key !== 'Tab' || !dialog) return

            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
            if (focusable.length === 0) return
            const first = focusable[0]
            const last = focusable[focusable.length - 1]

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault()
                last.focus()
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault()
                first.focus()
            }
        }

        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('keydown', onKeyDown)
            previouslyFocused?.focus()
        }
    }, [onClose])

    return (
        <div className="fixed inset-0 z-[100] bg-[#052d4a]/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className={`bg-white rounded-2xl shadow-2xl w-full ${SIZE[size]} overflow-hidden max-h-[92vh] flex flex-col`}
            >
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 id={titleId} className="text-lg font-bold text-[#052d4a]">{title}</h3>
                    <button
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto">{children}</div>
            </div>
        </div>
    )
}
