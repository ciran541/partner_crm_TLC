'use client'

import { X } from 'lucide-react'
import { ReactNode } from 'react'

interface ModalProps {
    title: string
    children: ReactNode
    onClose: () => void
}

/**
 * Shared Modal component.
 * Extracted from /dashboard/users/page.tsx for reuse across admin and property domains.
 */
export default function Modal({ title, children, onClose }: ModalProps) {
    return (
        <div className="fixed inset-0 z-[100] bg-[#052d4a]/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="text-lg font-bold text-[#052d4a]">{title}</h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">{children}</div>
            </div>
        </div>
    )
}
