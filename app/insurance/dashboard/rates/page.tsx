'use client'

import { Percent } from 'lucide-react'

export default function RatesPage() {
    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header - aligned with standard dashboard padding */}
            <div className="px-4 md:px-8 pt-20 md:pt-8 mb-4">
                <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                    <Percent size={28} className="text-[#03a9e7]" />
                    <span>Mortgage Package</span>
                </h1>
                <p className="text-slate-500 text-sm mt-1">View and manage live mortgage packages.</p>
            </div>

            {/* Iframe Container - No borders or shadows, flush with edges */}
            <div className="flex-1 relative overflow-hidden">
                <iframe
                    src="https://mortgage-package.vercel.app/dashboard"
                    className="absolute inset-0 w-full h-full border-0"
                    title="Mortgage Package Dashboard"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />
            </div>
        </div>
    )
}
