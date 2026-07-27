'use client'

import { FileText } from 'lucide-react'
import DocRetrievalGuide from '@/components/insurance/DocRetrievalGuide'

export default function DocumentGuidePage() {
    return (
        <div>
            {/* Header */}
            <div className="mb-5">
                <div className="flex items-center gap-2.5 mb-1">
                    <FileText size={22} className="text-[#03a9e7]" />
                    <h1 className="text-2xl font-bold text-[#052d4a]">Document Guide</h1>
                </div>
                <p className="text-sm text-slate-500 ml-[30px]">
                    How clients retrieve the HDB, CPF and IRAS documents an application needs
                </p>
            </div>

            <div className="max-w-4xl">
                <DocRetrievalGuide />
            </div>
        </div>
    )
}
