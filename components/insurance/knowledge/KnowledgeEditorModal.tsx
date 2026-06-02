'use client'

import { useState } from 'react'
import { X, Save } from 'lucide-react'
import {
    KnowledgeArticle, KnowledgeArticleInput,
    KNOWLEDGE_CATEGORIES, KNOWLEDGE_STEP_KEYS, KNOWLEDGE_CASE_TYPES,
} from '@/lib/types/knowledge'
import Spinner from '@/components/shared/Spinner'

interface Props {
    initial?: KnowledgeArticle | null
    seedTitle?: string   // prefill title when creating from a knowledge gap
    onSave: (input: KnowledgeArticleInput) => Promise<void>
    onClose: () => void
    saving: boolean
}

export default function KnowledgeEditorModal({ initial, seedTitle, onSave, onClose, saving }: Props) {
    const [title, setTitle] = useState(initial?.title ?? seedTitle ?? '')
    const [content, setContent] = useState(initial?.content ?? '')
    const [category, setCategory] = useState(initial?.category ?? KNOWLEDGE_CATEGORIES[0])
    const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(', '))
    const [caseTypes, setCaseTypes] = useState<string[]>(initial?.case_types ?? ['Refinancing'])
    const [stepKeys, setStepKeys] = useState<string[]>(initial?.step_keys ?? [])
    const [status, setStatus] = useState<'published' | 'draft'>(initial?.status ?? 'published')

    const toggle = (arr: string[], val: string, setter: (v: string[]) => void) =>
        setter(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val])

    const handleSubmit = () => {
        onSave({
            title: title.trim(),
            content: content.trim(),
            category,
            tags: tagsText.split(',').map(t => t.trim()).filter(Boolean),
            case_types: caseTypes,
            step_keys: stepKeys,
            status,
        })
    }

    const canSave = title.trim() && content.trim() && !saving

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(5,45,74,0.5)', backdropFilter: 'blur(4px)' }}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h3 className="text-lg font-bold text-[#052d4a]">{initial ? 'Edit Article' : 'New Article'}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400"><X size={20} /></button>
                </div>

                <div className="p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Title *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Subsidy and clawback — what to watch for"
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Content *</label>
                        <textarea value={content} onChange={e => setContent(e.target.value)} rows={8} placeholder="The expertise. Line breaks are preserved."
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 resize-y" style={{ fontFamily: 'inherit' }} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Category</label>
                            <select value={category} onChange={e => setCategory(e.target.value)}
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] bg-white">
                                {KNOWLEDGE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Status</label>
                            <select value={status} onChange={e => setStatus(e.target.value as 'published' | 'draft')}
                                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] bg-white">
                                <option value="published">Published (visible to agents)</option>
                                <option value="draft">Draft (admin only)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tags (comma-separated)</label>
                        <input value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder="subsidy, clawback, penalty"
                            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12" />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Applies to case types</label>
                        <div className="flex flex-wrap gap-2">
                            {KNOWLEDGE_CASE_TYPES.map(ct => (
                                <button key={ct} type="button" onClick={() => toggle(caseTypes, ct, setCaseTypes)}
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                        caseTypes.includes(ct) ? 'bg-[#052d4a] border-[#052d4a] text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7]'
                                    }`}>{ct}</button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Surface on workflow steps (contextual)</label>
                        <div className="flex flex-wrap gap-2">
                            {KNOWLEDGE_STEP_KEYS.map(s => (
                                <button key={s.key} type="button" onClick={() => toggle(stepKeys, s.key, setStepKeys)}
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                                        stepKeys.includes(s.key) ? 'bg-[#03a9e7] border-[#03a9e7] text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7]'
                                    }`}>{s.label}</button>
                            ))}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1.5">Leave empty if this article should only appear in search, not inside a step.</p>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex gap-3 justify-end shrink-0 bg-slate-50/50">
                    <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                    <button onClick={handleSubmit} disabled={!canSave} className="btn-primary px-5 py-2 text-sm flex items-center gap-2">
                        {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Save size={15} /> Save Article</>}
                    </button>
                </div>
            </div>
        </div>
    )
}
