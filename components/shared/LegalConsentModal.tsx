'use client'

import { useState, useRef, useEffect, ReactNode } from 'react'
import { X, Check } from 'lucide-react'

interface LegalConsentModalProps {
    isOpen: boolean
    title: string
    content: ReactNode
    alreadyAccepted: boolean
    onAccept: () => void
    onClose: () => void
}

export default function LegalConsentModal({
    isOpen,
    title,
    content,
    alreadyAccepted,
    onAccept,
    onClose
}: LegalConsentModalProps) {
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(alreadyAccepted)
    const contentRef = useRef<HTMLDivElement>(null)

    // Reset scroll state when modal opens, unless already accepted
    useEffect(() => {
        if (isOpen) {
            setHasScrolledToBottom(alreadyAccepted)
        }
    }, [isOpen, alreadyAccepted])

    // Check if the content is so short it doesn't need scrolling
    useEffect(() => {
        if (isOpen && contentRef.current) {
            const { scrollHeight, clientHeight } = contentRef.current
            if (scrollHeight <= clientHeight) {
                setHasScrolledToBottom(true)
            }
        }
    }, [isOpen])

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        if (hasScrolledToBottom) return

        const target = e.target as HTMLDivElement
        // Allow a 20px tolerance for "bottom"
        if (target.scrollTop + target.clientHeight >= target.scrollHeight - 20) {
            setHasScrolledToBottom(true)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
                onClick={onClose}
            />

            {/* Modal Box */}
            <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
                
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white">
                    <h2 className="text-xl font-bold text-slate-800">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Scrollable Content Area */}
                <div
                    ref={contentRef}
                    onScroll={handleScroll}
                    className="flex-1 overflow-y-auto p-6 bg-slate-50 text-sm text-slate-600 leading-relaxed"
                >
                    {content}
                </div>

                {/* Sticky Footer */}
                <div className="px-6 py-4 border-t border-slate-100 bg-white flex flex-col sm:flex-row items-center justify-end gap-3 shrink-0">
                    {!hasScrolledToBottom && !alreadyAccepted && (
                        <p className="text-xs text-slate-500 sm:mr-auto mb-2 sm:mb-0 italic">
                            Please scroll to the bottom to accept.
                        </p>
                    )}
                    
                    <button
                        onClick={onClose}
                        className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    
                    <button
                        onClick={() => {
                            if (hasScrolledToBottom || alreadyAccepted) {
                                onAccept()
                            }
                        }}
                        disabled={!hasScrolledToBottom && !alreadyAccepted}
                        className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        {alreadyAccepted ? (
                            <>
                                <Check size={18} /> Accepted
                            </>
                        ) : (
                            'I have read and agree'
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
