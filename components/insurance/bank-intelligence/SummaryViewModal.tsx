'use client'

import { X, ExternalLink, Landmark } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeHttpUrl } from '@/lib/types/news'
import { isPdfUrl, type BankIntelligenceReport } from '@/lib/types/bankIntelligence'

export default function SummaryViewModal({ report, onClose }: { report: BankIntelligenceReport; onClose: () => void }) {
    const pdfHref = safeHttpUrl(report.pdf_url)

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                    <div>
                        <p className="text-xs font-semibold text-[#03a9e7] flex items-center gap-1 mb-1">
                            <Landmark size={12} /> {report.bank}
                        </p>
                        <h3 className="text-lg font-bold text-[#052d4a]">{report.title}</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400 shrink-0"><X size={20} /></button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {pdfHref && (
                        <a href={pdfHref} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-semibold text-[#03a9e7] hover:text-[#0284c7] flex items-center gap-1 w-fit mb-4">
                            {pdfHref && isPdfUrl(pdfHref) ? 'View original PDF' : 'View original article'} <ExternalLink size={12} />
                        </a>
                    )}
                    <div className="prose prose-sm prose-slate max-w-none prose-headings:text-[#052d4a] prose-headings:font-bold prose-a:text-[#03a9e7] prose-table:text-xs prose-th:bg-slate-50">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.summary ?? ''}</ReactMarkdown>
                    </div>
                </div>
            </div>
        </div>
    )
}
