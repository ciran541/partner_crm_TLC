'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import RatesView from '@/components/insurance/rates/RatesView'

// What agents see on their Rates page: published packages only, read-only.
export default function AdminRatesPreviewPage() {
    return (
        <div>
            <Link href="/admin/insurance/rates" className="text-sm text-slate-500 hover:text-[#03a9e7] inline-flex items-center gap-1 mb-2 py-1"><ArrowLeft size={14} /> Back to rates</Link>
            <p className="mb-3 inline-block rounded-full bg-sky-50 text-sky-800 text-xs font-semibold px-3 py-1">Agent view: exactly what agents see</p>
            <RatesView forceReadOnly />
        </div>
    )
}
