'use client'

import { useState } from 'react'
import { CheckCircle2, Circle, FolderCheck, HelpCircle, X } from 'lucide-react'
import type { CaseDocument } from '@/lib/insurance/caseDocuments'
import DocRetrievalGuide from '@/components/insurance/DocRetrievalGuide'

interface Props {
    documents: CaseDocument[]
    done: string[]
    onToggle: (id: string) => void
}

/**
 * "Documents to prepare" — the case-specific document checklist shown in the
 * Next-step card once a package is picked. Guide-backed items get a "How to
 * retrieve" link that opens the illustrated walkthrough in a modal, filtered to
 * that one document. Works the same for digital and manual banks.
 */
export default function DocumentsToPrepare({ documents, done, onToggle }: Props) {
    // The guide document id currently shown in the modal (null = closed).
    const [guideDocId, setGuideDocId] = useState<string | null>(null)

    if (documents.length === 0) return null

    return (
        <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-2">
                <FolderCheck size={13} /> Documents to prepare
            </p>
            <ul className="space-y-1.5">
                {documents.map(doc => {
                    const isDone = done.includes(doc.id)
                    return (
                        <li key={doc.id} className="flex items-start gap-2.5">
                            <button type="button" onClick={() => onToggle(doc.id)}
                                className="flex items-start gap-2.5 text-left group min-w-0 flex-1">
                                {isDone
                                    ? <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                                    : <Circle size={16} className="text-slate-300 group-hover:text-[#03a9e7] shrink-0 mt-0.5" />}
                                <span className="min-w-0">
                                    <span className={`text-[13px] ${isDone ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{doc.label}</span>
                                    {doc.note && <span className="block text-[11px] text-slate-400">{doc.note}</span>}
                                </span>
                            </button>
                            {doc.guideDocId && (
                                <button type="button" onClick={() => setGuideDocId(doc.guideDocId!)}
                                    className="shrink-0 mt-0.5 text-[11px] font-semibold text-[#03a9e7] hover:text-[#052d4a] inline-flex items-center gap-1">
                                    <HelpCircle size={12} /> How to retrieve
                                </button>
                            )}
                        </li>
                    )
                })}
            </ul>

            {/* Guide modal */}
            {guideDocId && (
                <div className="fixed inset-0 z-[80] bg-[#052d4a]/40 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setGuideDocId(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
                        onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                            <h3 className="text-base font-bold text-[#052d4a]">How to retrieve this document</h3>
                            <button type="button" aria-label="Close" onClick={() => setGuideDocId(null)}
                                className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto">
                            <DocRetrievalGuide embedded onlyDocIds={[guideDocId]} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
