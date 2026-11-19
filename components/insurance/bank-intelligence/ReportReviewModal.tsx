'use client'

import { useState } from 'react'
import { X, ExternalLink } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { isPdfUrl, reportLinkHref, type BankIntelligenceReport } from '@/lib/types/bankIntelligence'

interface Props {
    report: BankIntelligenceReport
    saving: boolean
    onSave: (summary: string, publish: boolean) => void
    onReExtract: () => void
    reExtracting: boolean
    onClose: () => void
}

// Review screen for an AI-extracted summary before it reaches agents — the
// admin-review gate. Editable so a wrong figure can be fixed in place rather
// than forcing a full re-extraction.
export default function ReportReviewModal({ report, saving, onSave, onReExtract, reExtracting, onClose }: Props) {
    const [summary, setSummary] = useState(report.summary ?? '')
    const pdfHref = reportLinkHref(report)

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                    <div>
                        <h3 className="text-lg font-bold text-[#052d4a]">{report.title}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{report.bank}{report.series ? ` · ${report.series}` : ''} ·{report.published_date ? new Date(report.published_date).toLocaleDateString('en-SG') : '—'}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-3">
                    {pdfHref && (
                        <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[#03a9e7] hover:text-[#0284c7] flex items-center gap-1 w-fit">
                            {isPdfUrl(report.pdf_url) ? 'View original PDF' : 'View original article'} <ExternalLink size={12} />
                        </a>
                    )}

                    {report.extraction_error && (
                        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2.5">
                            Last extraction failed: {report.extraction_error}
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">AI-extracted summary (editable)</label>
                        <textarea
                            value={summary}
                            onChange={e => setSummary(e.target.value)}
                            rows={16}
                            placeholder={report.summary ? '' : 'No summary yet — click "Re-run extraction" to generate one.'}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] font-mono leading-relaxed"
                        />
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
                    <button onClick={onReExtract} disabled={reExtracting || saving}
                        className="px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7] transition-colors flex items-center gap-2 disabled:opacity-50">
                        {reExtracting ? <Spinner size="sm" color="#64748b" /> : null}
                        Re-run extraction
                    </button>
                    <div className="flex items-center gap-2">
                        <button onClick={() => onSave(summary, false)} disabled={saving || reExtracting}
                            className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 transition-colors disabled:opacity-50">
                            Save draft
                        </button>
                        <button onClick={() => onSave(summary, true)} disabled={saving || reExtracting || !summary.trim()}
                            className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                            {report.is_published ? 'Save & keep published' : 'Save & publish'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
