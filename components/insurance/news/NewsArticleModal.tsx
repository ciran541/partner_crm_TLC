'use client'

import { useState } from 'react'
import { X, Save } from 'lucide-react'
import { NewsArticleInput, NEWS_SOURCES } from '@/lib/types/news'
import Spinner from '@/components/shared/Spinner'

interface Props {
    saving: boolean
    onSave: (input: NewsArticleInput) => Promise<void>
    onClose: () => void
}

export default function NewsArticleModal({ saving, onSave, onClose }: Props) {
    const [sourceKey, setSourceKey] = useState<string>(NEWS_SOURCES[0].key)
    const [title, setTitle] = useState('')
    const [url, setUrl] = useState('')
    const [description, setDescription] = useState('')
    const [publishedAt, setPublishedAt] = useState(new Date().toISOString().slice(0, 10))

    const source = NEWS_SOURCES.find(s => s.key === sourceKey) ?? NEWS_SOURCES[0]

    const handleSubmit = () => {
        onSave({
            source: source.name,
            feed_key: source.key,
            title: title.trim(),
            url: url.trim(),
            description: description.trim() || null,
            published_at: new Date(publishedAt).toISOString(),
        })
    }

    const canSave = title.trim() && url.trim() && !saving

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 className="text-lg font-bold text-[#052d4a]">Add Article (QA)</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    <p className="text-xs text-slate-400">For one-off additions the automated feed missed — not required for the feed to work day-to-day.</p>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Source</label>
                        <select value={sourceKey} onChange={e => setSourceKey(e.target.value)}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] bg-white">
                            {NEWS_SOURCES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Title *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Article headline"
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">URL *</label>
                        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…"
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Snippet (used for the AI summary)</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 resize-y" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Published date</label>
                        <input type="date" value={publishedAt} onChange={e => setPublishedAt(e.target.value)}
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0 bg-slate-50/50">
                    <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                    <button onClick={handleSubmit} disabled={!canSave} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                        {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Save size={15} /> Add Article</>}
                    </button>
                </div>
            </div>
        </div>
    )
}
