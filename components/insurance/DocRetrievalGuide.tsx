'use client'

import { useState } from 'react'
import { ChevronDown, ExternalLink, FileText, Info, ShieldCheck, X } from 'lucide-react'
import { DOC_RETRIEVAL_GUIDE, type GuideInstitution } from '@/lib/insurance/docRetrievalGuide'

const IMG_BASE = '/guides/doc-retrieval'

const INSTITUTION_ACCENT: Record<GuideInstitution['key'], string> = {
    hdb: 'text-[#03a9e7]',
    cpf: 'text-emerald-600',
    iras: 'text-violet-600',
}

interface Props {
    /** If provided, only these document ids are shown (in guide order); institutions
     *  with no matching document are hidden. Used to tailor the guide to a case. */
    onlyDocIds?: string[]
    /** Hide the intro blurb + quick-jump chips (e.g. when embedded in a modal). */
    embedded?: boolean
}

export default function DocRetrievalGuide({ onlyDocIds, embedded }: Props) {
    const institutions = onlyDocIds
        ? DOC_RETRIEVAL_GUIDE
              .map(inst => ({ ...inst, documents: inst.documents.filter(d => onlyDocIds.includes(d.id)) }))
              .filter(inst => inst.documents.length > 0)
        : DOC_RETRIEVAL_GUIDE

    // First visible document open by default so the panel doesn't read as an empty wall.
    const [open, setOpen] = useState<string | null>(institutions[0]?.documents[0]?.id ?? null)
    const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)

    const toggle = (id: string) => setOpen(cur => (cur === id ? null : id))

    return (
        <div>
            {!embedded && (
                <>
                    {/* Intro */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 mb-5 space-y-2.5">
                        <p className="text-sm text-slate-600 leading-relaxed flex items-start gap-2">
                            <FileText size={16} className="text-[#03a9e7] shrink-0 mt-0.5" />
                            <span>
                                Step-by-step guides your client can follow to retrieve the HDB, CPF and IRAS
                                documents an application needs. Walk them through on a call, or share the steps.
                            </span>
                        </p>
                        <p className="text-xs text-slate-500 flex items-start gap-2">
                            <ShieldCheck size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                            Every portal requires the client to log in with their own <strong className="font-semibold text-slate-600">SingPass</strong>.
                            Agents never log in on the client&apos;s behalf.
                        </p>
                    </div>

                    {/* Quick jump */}
                    <div className="flex flex-wrap gap-2 mb-6">
                        {institutions.map(inst => (
                            <a key={inst.key} href={`#${inst.key}`}
                                className="text-xs font-semibold px-3 py-1.5 rounded-full border border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#052d4a] transition-colors">
                                {inst.label} <span className="text-slate-400">· {inst.documents.length}</span>
                            </a>
                        ))}
                    </div>
                </>
            )}

            {institutions.map(inst => (
                <section key={inst.key} id={inst.key} className="mb-8 scroll-mt-4">
                    <div className="mb-3">
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <h2 className={`text-lg font-bold ${INSTITUTION_ACCENT[inst.key]}`}>{inst.label}</h2>
                            <a href={inst.portalUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs font-semibold text-slate-500 hover:text-[#052d4a] inline-flex items-center gap-1 border border-slate-200 rounded-full px-2.5 py-1">
                                Open {inst.portalLabel} <ExternalLink size={11} />
                            </a>
                        </div>
                        <p className="text-xs text-slate-500 mt-1">{inst.blurb}</p>
                    </div>

                    <div className="space-y-2.5">
                        {inst.documents.map(doc => {
                            const isOpen = open === doc.id
                            return (
                                <div key={doc.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                    <button type="button" onClick={() => toggle(doc.id)}
                                        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                                        <span>
                                            <span className="text-sm font-semibold text-[#052d4a]">{doc.title}</span>
                                            {doc.note && <span className="block text-[11px] text-slate-400 mt-0.5">{doc.note}</span>}
                                        </span>
                                        <ChevronDown size={18}
                                            className={`text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    {isOpen && (
                                        <ol className="px-4 pb-4 pt-3 border-t border-slate-100 space-y-5">
                                            {doc.steps.map((step, i) => {
                                                const alt = `${doc.title} — step ${i + 1}`
                                                const src = step.image ? `${IMG_BASE}/${step.image}` : null
                                                return (
                                                    <li key={i} className="flex gap-3">
                                                        <span className="shrink-0 w-6 h-6 rounded-full bg-[#052d4a] text-white text-xs font-bold flex items-center justify-center">
                                                            {i + 1}
                                                        </span>
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-sm text-slate-700 leading-relaxed">{step.text}</p>
                                                            {src && (
                                                                // eslint-disable-next-line @next/next/no-img-element
                                                                <img
                                                                    src={src}
                                                                    alt={alt}
                                                                    loading="lazy"
                                                                    onClick={() => setLightbox({ src, alt })}
                                                                    className="mt-2.5 w-full max-w-xl rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:border-[#03a9e7] transition-colors"
                                                                />
                                                            )}
                                                        </div>
                                                    </li>
                                                )
                                            })}
                                        </ol>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </section>
            ))}

            <p className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-6">
                <Info size={12} /> Portal layouts change from time to time — if a screen looks different, the labels in the steps still apply.
            </p>

            {/* Lightbox */}
            {lightbox && (
                <div
                    className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
                    onClick={() => setLightbox(null)}
                >
                    <button type="button" aria-label="Close"
                        className="absolute top-4 right-4 text-white/80 hover:text-white"
                        onClick={() => setLightbox(null)}>
                        <X size={28} />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lightbox.src} alt={lightbox.alt}
                        className="max-w-full max-h-[90vh] rounded-lg shadow-2xl"
                        onClick={e => e.stopPropagation()} />
                </div>
            )}
        </div>
    )
}
