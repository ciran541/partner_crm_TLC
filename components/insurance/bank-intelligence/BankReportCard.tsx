'use client'

import { useState } from 'react'
import { Landmark, ExternalLink, ChevronRight } from 'lucide-react'
import { isPdfUrl, stripMarkdownPreview, type BankIntelligenceReport } from '@/lib/types/bankIntelligence'
import { safeHttpUrl } from '@/lib/types/news'
import SummaryViewModal from '@/components/insurance/bank-intelligence/SummaryViewModal'

const BANK_COLORS: Record<string, string> = {
    ocbc:    'bg-red-50 text-red-700',
    uob:     'bg-blue-50 text-blue-700',
    hsbc:    'bg-orange-50 text-orange-700',
    maybank: 'bg-yellow-50 text-yellow-700',
    sc:      'bg-emerald-50 text-emerald-700',
    dbs:     'bg-cyan-50 text-cyan-700',
}

export default function BankReportCard({ report }: { report: BankIntelligenceReport }) {
    const [viewing, setViewing] = useState(false)
    const pdfHref = safeHttpUrl(report.pdf_url)
    const preview = report.summary ? stripMarkdownPreview(report.summary) : null

    return (
        <>
            <div className="card !p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${BANK_COLORS[report.bank_key] ?? 'bg-slate-100 text-slate-600'}`}>
                            <Landmark size={11} /> {report.bank}
                        </span>
                        <span className="text-xs text-slate-400">
                            {report.published_date ? new Date(report.published_date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                        </span>
                    </div>
                    {pdfHref && (
                        <a href={pdfHref} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-semibold text-[#03a9e7] hover:text-[#0284c7] flex items-center gap-1 shrink-0">
                            {isPdfUrl(pdfHref) ? 'Original PDF' : 'Original Article'} <ExternalLink size={12} />
                        </a>
                    )}
                </div>

                <p className="font-semibold text-sm text-[#052d4a] mb-2">{report.title}</p>

                {preview ? (
                    <>
                        <p className="text-xs text-slate-600 leading-relaxed">{preview}</p>
                        <button onClick={() => setViewing(true)}
                            className="mt-2 text-xs font-semibold text-[#03a9e7] hover:text-[#0284c7] flex items-center gap-1">
                            Read full summary <ChevronRight size={13} />
                        </button>
                    </>
                ) : (
                    <p className="text-xs text-slate-400 italic">Summary not yet available.</p>
                )}
            </div>

            {viewing && <SummaryViewModal report={report} onClose={() => setViewing(false)} />}
        </>
    )
}
