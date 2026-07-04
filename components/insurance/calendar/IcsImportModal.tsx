'use client'

import { useState } from 'react'
import { X, Upload } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'

interface Props {
    onClose: () => void
    onImported: () => void
}

// BLS blocks automated fetches of both their HTML schedule and their own
// bls.ics file (confirmed by direct testing), so this is a manual, roughly
// annual admin action: download bls.ics in a real browser, paste its content
// here. BLS publishes ~18 months ahead, so this rarely needs repeating.
export default function IcsImportModal({ onClose, onImported }: Props) {
    const [content, setContent] = useState('')
    const [importing, setImporting] = useState(false)
    const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)
    const [error, setError] = useState<string | null>(null)

    const handleImport = async () => {
        setImporting(true)
        setError(null)
        try {
            const res = await fetch('/api/admin/insurance/calendar/import-cpi-ics', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ icsContent: content }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error ?? 'Import failed')
            setResult({ imported: json.imported, skipped: json.skipped })
            onImported()
        } catch (e: any) {
            setError(e.message ?? 'Import failed')
        } finally {
            setImporting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 className="text-lg font-bold text-[#052d4a]">Import CPI Release Dates</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-3 overflow-y-auto">
                    <p className="text-xs text-slate-500">
                        Download <span className="font-mono bg-slate-100 px-1 rounded">bls.gov/schedule/news_release/bls.ics</span> in
                        your browser (BLS blocks automated downloads of this file), open it in a text editor, and paste the full contents
                        below. Only entries with <span className="font-mono bg-slate-100 px-1 rounded">SUMMARY:Consumer Price Index</span> are
                        imported — everything else in the file is ignored. Existing dates are never overwritten, so this is safe to re-run.
                    </p>
                    <textarea
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        rows={12}
                        placeholder="BEGIN:VCALENDAR..."
                        className="w-full px-3 py-2.5 text-xs font-mono rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] resize-y"
                    />
                    {result && (
                        <div className="text-sm bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-emerald-700">
                            Imported {result.imported} CPI date{result.imported === 1 ? '' : 's'}
                            {result.skipped > 0 && ` (${result.skipped} skipped due to errors)`}.
                        </div>
                    )}
                    {error && <p className="text-xs text-red-500">{error}</p>}
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0 bg-slate-50/50">
                    <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Close</button>
                    <button onClick={handleImport} disabled={!content.trim() || importing} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                        {importing ? <Spinner size="sm" color="white" label="Importing…" /> : <><Upload size={15} /> Import</>}
                    </button>
                </div>
            </div>
        </div>
    )
}
