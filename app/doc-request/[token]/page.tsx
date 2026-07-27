import { CheckCircle2, FileText, ShieldCheck } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { caseDocumentsFromWorkflow, type CaseType } from '@/lib/insurance/caseDocuments'
import DocRetrievalGuide from '@/components/insurance/DocRetrievalGuide'

export const metadata = { title: 'Documents to prepare · The Loan Connection' }

// Public, tokenised page — no login. Shows only the client's first name and the
// documents their case needs (plus how to retrieve the online ones). Nothing
// financial and no other case data is exposed.
export default async function DocRequestPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params

    const admin = createAdminClient()
    const { data: row } = await admin
        .from('cases')
        .select('case_type, client_name, workflow_data')
        .eq('doc_request_token', token)
        .maybeSingle()

    if (!row) return <NotFoundCard />

    const documents = caseDocumentsFromWorkflow(row.case_type as CaseType, row.workflow_data as Record<string, unknown>)
    const firstName = (row.client_name ?? '').trim().split(/\s+/)[0]
    const guideIds = [...new Set(documents.filter(d => d.guideDocId).map(d => d.guideDocId!))]

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <div className="bg-gradient-to-br from-[#052d4a] to-[#0f4a75] px-5 py-8">
                <div className="max-w-3xl mx-auto">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-white/60">The Loan Connection</p>
                    <h1 className="text-2xl font-bold text-white mt-1 flex items-center gap-2">
                        <FileText size={22} /> Documents to prepare
                    </h1>
                </div>
            </div>

            <div className="max-w-3xl mx-auto px-5 py-6">
                <p className="text-[15px] text-slate-700 leading-relaxed mb-1">
                    {firstName ? `Hi ${firstName},` : 'Hi,'}
                </p>
                <p className="text-sm text-slate-600 leading-relaxed mb-5">
                    To move your loan application forward, please prepare the documents below. Steps
                    (with screenshots) for retrieving the HDB, CPF and IRAS documents are further down.
                </p>

                {documents.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
                        Your advisor will confirm the exact documents shortly.
                    </div>
                ) : (
                    <>
                        {/* Checklist */}
                        <div className="rounded-xl border border-slate-200 bg-white p-4 mb-5">
                            <ul className="space-y-2.5">
                                {documents.map(doc => (
                                    <li key={doc.id} className="flex items-start gap-2.5">
                                        <CheckCircle2 size={17} className="text-[#03a9e7] shrink-0 mt-0.5" />
                                        <span>
                                            <span className="text-sm text-slate-700">{doc.label}</span>
                                            {doc.note && <span className="block text-[11px] text-slate-400">{doc.note}</span>}
                                            {doc.guideDocId && <span className="block text-[11px] text-[#03a9e7] font-medium">See retrieval steps below ↓</span>}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <p className="text-xs text-slate-500 flex items-start gap-2 mb-6">
                            <ShieldCheck size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                            You&apos;ll log in to each portal with your own SingPass. Only you can access your records.
                        </p>

                        {/* Retrieval walkthroughs (guide-backed docs only) */}
                        {guideIds.length > 0 && (
                            <div>
                                <h2 className="text-base font-bold text-[#052d4a] mb-3">How to retrieve your documents</h2>
                                <DocRetrievalGuide embedded onlyDocIds={guideIds} />
                            </div>
                        )}
                    </>
                )}

                <p className="text-[11px] text-slate-400 mt-8 pt-5 border-t border-slate-200">
                    Sent by your advisor at The Loan Connection. Please reach out to them directly with any questions.
                </p>
            </div>
        </div>
    )
}

function NotFoundCard() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
            <div className="max-w-md text-center">
                <FileText size={32} className="text-slate-300 mx-auto mb-3" />
                <h1 className="text-lg font-bold text-[#052d4a] mb-1">Link not found</h1>
                <p className="text-sm text-slate-500">
                    This document checklist link is invalid or has expired. Please ask your advisor for an updated link.
                </p>
            </div>
        </div>
    )
}
