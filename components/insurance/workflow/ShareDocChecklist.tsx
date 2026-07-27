'use client'

import { useEffect, useState } from 'react'
import { Send, Copy, Check, Mail, MessageCircle, X } from 'lucide-react'

interface Props {
    caseId?: string
    clientName?: string
    clientEmail?: string
}

/**
 * "Send document checklist" — mints (or reuses) the case's public doc-request link
 * and lets the agent copy it, copy a WhatsApp-ready message, or email it to the
 * client. Self-contained: owns its own API calls + modal so each workflow only
 * drops in <ShareDocChecklist caseId … />.
 */
export default function ShareDocChecklist({ caseId, clientName, clientEmail }: Props) {
    const [open, setOpen] = useState(false)
    const [url, setUrl] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState<'link' | 'whatsapp' | null>(null)
    const [emailing, setEmailing] = useState(false)
    const [emailed, setEmailed] = useState(false)

    const firstName = (clientName ?? '').trim().split(/\s+/)[0]
    const whatsappMsg = `Hi${firstName ? ' ' + firstName : ''}, here's the document checklist for your loan application: ${url}`

    // Fetch (or create) the link the first time the modal opens.
    useEffect(() => {
        if (!open || url || !caseId) return
        setLoading(true)
        setError(null)
        fetch(`/api/insurance/cases/${caseId}/doc-request`, { method: 'POST' })
            .then(async r => {
                const json = await r.json()
                if (!r.ok) throw new Error(json.error ?? 'Could not create link')
                setUrl(json.url)
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false))
    }, [open, url, caseId])

    const copy = async (text: string, which: 'link' | 'whatsapp') => {
        try {
            await navigator.clipboard.writeText(text)
            setCopied(which)
            setTimeout(() => setCopied(null), 1800)
        } catch { /* clipboard blocked — ignore */ }
    }

    const emailToClient = async () => {
        if (!caseId) return
        setEmailing(true)
        setError(null)
        try {
            const r = await fetch(`/api/insurance/cases/${caseId}/doc-request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sendEmail: true }),
            })
            const json = await r.json()
            if (!r.ok) throw new Error(json.error ?? 'Could not send email')
            setEmailed(true)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not send email')
        } finally {
            setEmailing(false)
        }
    }

    return (
        <>
            <button type="button" onClick={() => setOpen(true)}
                className="text-sm px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 flex items-center gap-2">
                <Send size={15} /> Send document checklist
            </button>

            {open && (
                <div className="fixed inset-0 z-[80] bg-[#052d4a]/40 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setOpen(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <h3 className="text-base font-bold text-[#052d4a]">Send document checklist</h3>
                            <button type="button" aria-label="Close" onClick={() => setOpen(false)}
                                className="p-1 hover:bg-slate-200 rounded-full text-slate-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <p className="text-[13px] text-slate-500">
                                A private link showing {firstName || 'your client'} exactly which documents to prepare, with retrieval steps.
                            </p>

                            {loading && <p className="text-sm text-slate-400">Generating link…</p>}
                            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

                            {url && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <input readOnly value={url}
                                            className="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 text-slate-600 outline-none" />
                                        <button type="button" onClick={() => copy(url, 'link')}
                                            className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
                                            {copied === 'link' ? <><Check size={13} className="text-emerald-500" /> Copied</> : <><Copy size={13} /> Copy</>}
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2">
                                        <button type="button" onClick={() => copy(whatsappMsg, 'whatsapp')}
                                            className="text-sm px-4 py-2.5 rounded-lg bg-[#052d4a] text-white font-semibold hover:bg-[#063a5e] flex items-center justify-center gap-2">
                                            {copied === 'whatsapp' ? <><Check size={15} /> Message copied</> : <><MessageCircle size={15} /> Copy WhatsApp message</>}
                                        </button>

                                        <button type="button" onClick={emailToClient}
                                            disabled={!clientEmail || emailing || emailed}
                                            title={!clientEmail ? 'Add client email in case details first' : `Email the link to ${clientEmail}`}
                                            className={`text-sm px-4 py-2.5 rounded-lg border font-semibold flex items-center justify-center gap-2 transition-colors ${
                                                emailed
                                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                    : !clientEmail
                                                        ? 'border-slate-200 text-slate-300 cursor-not-allowed'
                                                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}>
                                            <Mail size={15} />
                                            {emailing ? 'Sending…' : emailed ? 'Emailed to client' : 'Email link to client'}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
