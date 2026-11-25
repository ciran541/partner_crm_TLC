'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'

/** "We couldn't load this": never to be confused with "there is nothing". */
export default function LoadFailed({ message, onRetry }: { message: string; onRetry?: () => void }) {
    return (
        <div role="alert" className="card p-4 flex items-center gap-3 text-sm text-red-700">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{message}</span>
            {onRetry && (
                <button type="button" onClick={onRetry}
                    className="min-h-[40px] px-3 rounded-full border border-red-200 text-xs font-bold flex items-center gap-1.5 hover:bg-red-50 shrink-0">
                    <RefreshCw size={12} /> Try again
                </button>
            )}
        </div>
    )
}
