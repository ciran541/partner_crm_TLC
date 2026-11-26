'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, FileUp, Pencil, Plus, Sparkles, X } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import { buildLadders, byCategoryAndLoan, money } from '@/lib/insurance/rateLadders'
import { restrictedTo } from '@/lib/insurance/rateFilters'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import {
    applyFeatureChoice, applyProposals, setFeatures, flagDuplicates, isCash, ladderTitle, matchRead, packageLabel, phraseOf, resolveItem, unmentioned, unreadRateLines,
    type FeatureDiff, type MatchContext, type Proposal, type RateAlias, type RateRead, type RecentSource,
} from '@/lib/insurance/rateUpdate'
import type { RateSource } from '@/lib/insurance/rateMaster'
import type { MortgagePackage } from '@/lib/types/rates'

interface Props {
    bank: string
    packages: MortgagePackage[]
    aliases: RateAlias[]
    recent: RecentSource[]
    today: string
    onApply: (next: MortgagePackage[], source: RateSource, aliases: RateAlias[], bankNotes: string[]) => void
}

interface ReadState { read: RateRead; text: string | null; file_path?: string; file_name?: string; reused: boolean }

const inputCls = 'w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7] bg-white'

export default function SmartUpdate({ bank, packages, aliases, recent, today, onApply }: Props) {
    const [text, setText] = useState('')
    const [files, setFiles] = useState<File[]>([])
    const [listType, setListType] = useState<'partial' | 'full'>('partial')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [state, setState] = useState<ReadState | null>(null)
    const [proposals, setProposals] = useState<Proposal[]>([])
    const [learned, setLearned] = useState<RateAlias[]>([])
    const [remember, setRemember] = useState(true)
    const [seenUnread, setSeenUnread] = useState(false)

    const context = (s: ReadState): MatchContext => ({
        bank, packages, read: s.read, text: s.text, banker: '', today, aliases, recent,
        fullList: listType === 'full', newId: () => crypto.randomUUID(),
    })

    const readMessage = async () => {
        setBusy(true); setError(null)
        try {
            const form = new FormData()
            form.set('bank', bank)
            if (text.trim()) form.set('text', text.trim())
            files.forEach(f => form.append('file', f))
            const res = await fetch('/api/admin/rates/read', { method: 'POST', body: form })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Could not read that message')
            const s: ReadState = { read: json.read, text: files.length ? null : text.trim(), file_path: json.file_path, file_name: json.file_name, reused: json.reused }
            if (!s.read.items.length) throw new Error('No packages were found in that message.')
            setState(s); setLearned([]); setSeenUnread(false)
            setProposals(matchRead(context(s)))
        } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) }
    }

    const unread = useMemo(() => state?.text ? unreadRateLines(state.text, state.read) : [], [state])
    const ladders = useMemo(() => buildLadders(packages, today), [packages, today])

    /** Answer a question; the same wording elsewhere in this message gets the same answer. */
    const answer = (p: Proposal, key: string | null) => {
        if (!state || !p.item) return
        const ctx = context(state)
        const phrase = phraseOf(p.item)
        const ladder = key ? ladders.find(l => l.key === key) ?? null : null
        const same = proposals.filter(x => x.kind === 'ask' && x.item && phraseOf(x.item) === phrase)
        const rest = proposals.filter(x => !x.id.startsWith('gone-'))
            .flatMap(x => same.includes(x) ? resolveItem(x.item!, ladder, ctx, x.id) : [x])
        flagDuplicates(rest)
        setProposals(ctx.fullList ? [...rest, ...unmentioned(ctx, rest)] : rest)
        if (key) setLearned(l => [...l.filter(a => a.phrase !== phrase), { banker: '', phrase, ladder_key: key }])
    }
    const skip = (p: Proposal) => setProposals(ps => ps.filter(x => x.id !== p.id))
    const toggle = (p: Proposal) => setProposals(ps => ps.map(x => x.id === p.id ? { ...x, accepted: !x.accepted } : x))

    const cash = [...new Set((state?.read.items ?? []).flatMap(i => i.features.filter(isCash)))]
    const choose = (d: FeatureDiff, useBanker: boolean) => setProposals(ps => applyFeatureChoice(ps, d, useBanker))
    const editFeatures = (p: Proposal, features: string[]) => setProposals(ps => ps.map(x => x.id === p.id ? setFeatures(x, features) : x))
    const pkgOf = (p: Proposal) => (p.proposed ?? p.current)!
    const sorted = (ps: Proposal[]) => [...ps].sort((a, b) => byCategoryAndLoan(pkgOf(a), pkgOf(b)))
    const unchanged = sorted(proposals.filter(isUnchanged))
    const decide = proposals.filter(p => p.kind !== 'ask' && !isUnchanged(p))
    const asks = proposals.filter(p => p.kind === 'ask')
    const ticked = proposals.filter(p => p.accepted && p.kind !== 'ask' && p.level !== 'red')
    const waiting = proposals.filter(p => !p.accepted && p.kind !== 'ask')
    const blocked = asks.length > 0 || (unread.length > 0 && !seenUnread)

    const apply = () => {
        if (!state) return
        onApply(applyProposals(packages, proposals), {
            received_on: today, text: state.text ?? undefined, file_path: state.file_path, file_name: state.file_name,
        }, remember ? learned : [], state.read.notes)
    }

    if (!state) return (
        <div className="space-y-3 max-w-3xl">
        <Steps at={1} />
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            {error && <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="max-w-md">
                <div className="text-xs font-semibold text-slate-500">This message is
                    <div className="flex mt-1 rounded-lg border border-slate-200 overflow-hidden">
                        {([['partial', 'Some changes'], ['full', 'Full list']] as const).map(([k, label]) => (
                            <button key={k} type="button" onClick={() => setListType(k)} className={`flex-1 py-2.5 text-sm font-medium ${listType === k ? 'bg-[#052d4a] text-white' : 'bg-white text-slate-600'}`}>{label}</button>
                        ))}
                    </div>
                    <p className="font-normal text-slate-400 mt-1">{listType === 'full' ? 'Packages not mentioned are listed for you to remove. None are removed unless you tick them.' : 'Packages not mentioned stay as they are. Choose this if you are not sure.'}</p>
                </div>
            </div>
            <label className="block text-xs font-semibold text-slate-500">Paste the message
                <textarea value={text} onChange={e => setText(e.target.value)} rows={11} disabled={files.length > 0} placeholder="Paste the banker's message exactly as it is" className={`${inputCls} mt-1 font-mono font-normal disabled:bg-slate-50`} />
            </label>
            <div className="flex items-center gap-3 flex-wrap">
                <label className={`text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 inline-flex items-center gap-2 ${text.trim() ? 'opacity-40' : 'cursor-pointer hover:border-[#03a9e7]'}`}>
                    <FileUp size={16} /> PDF or screenshots
                    <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={!!text.trim()} className="hidden" onChange={e => setFiles([...(e.target.files ?? [])])} />
                </label>
                {files.length > 0 && <span className="text-sm text-slate-600">{files.map(f => f.name).join(', ')} <button type="button" onClick={() => setFiles([])} className="ml-1 underline text-slate-400">remove</button></span>}
                <button type="button" onClick={readMessage} disabled={busy || (!text.trim() && !files.length)} className="btn-primary ml-auto px-5 py-2.5 text-sm inline-flex items-center gap-2">
                    {busy ? <Spinner size="sm" color="white" label="Reading…" /> : <><Sparkles size={15} /> Read and compare</>}
                </button>
            </div>
        </div>
        </div>
    )

    return (
        <div className="space-y-4 pb-24">
            <Steps at={2} />
            <div className="flex items-center gap-3 flex-wrap text-sm text-slate-600">
                <button type="button" onClick={() => setState(null)} className="btn-ghost px-3 py-2 text-sm border border-slate-200">Back to message</button>
                <span>{proposals.filter(p => p.kind === 'change').length} changed · {proposals.filter(p => p.kind === 'new').length} new · {proposals.filter(p => p.kind === 'same').length} unchanged · {asks.length} to answer</span>
                {state.reused && <span className="text-slate-400">Already read before, so no AI cost</span>}
            </div>
            {state.read.scope === 'full' && listType === 'partial' && <Note>This looks like a full list. Go back and choose &ldquo;Full list&rdquo; to see packages it no longer mentions.</Note>}
            {listType === 'full' && state.read.scope !== 'full' && proposals.some(p => p.kind === 'remove' && !p.item) && <Note>This may not be a full list. Check before removing anything.</Note>}
            {!state.text && <Note>Read from a file, so rates can&apos;t be checked against the text automatically. Compare each one with the original.</Note>}
            {state.read.notes.length > 0 && <Note>Bank-wide notes found: {state.read.notes.join(' · ')}</Note>}
            {unread.length > 0 && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                    <p className="font-semibold">These lines have a rate but weren&apos;t used. A package may be missing:</p>
                    <ul className="my-1.5 font-mono text-xs">{unread.map(u => <li key={u.line}>Line {u.line}: {u.text}</li>)}</ul>
                    <label className="inline-flex items-center gap-2 py-1"><input type="checkbox" checked={seenUnread} onChange={e => setSeenUnread(e.target.checked)} /> I&apos;ve checked them</label>
                </div>
            )}

            {asks.map(p => (
                <div key={p.id} className="rounded-xl border-2 border-amber-300 bg-white p-4">
                    <p className="font-semibold text-sm text-[#052d4a]">{p.item!.name || p.item!.category} {p.item!.min_loan != null && `· ${money(p.item!.min_loan)}`} <span className="font-normal text-slate-500">{p.item!.rates.map(formatRateEntry).join(', ')}</span></p>
                    <p className="text-sm text-amber-800 mt-1">{p.warnings.join('. ')}{p.candidates.length ? '. Which one is it?' : ''}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {p.candidates.map(c => <button key={c.key} type="button" onClick={() => answer(p, c.key)} className="px-3 py-2.5 text-sm rounded-lg border border-[#03a9e7] text-[#0277a8] font-medium hover:bg-sky-50">{c.label}</button>)}
                        {p.item!.action === 'offer' && <button type="button" onClick={() => answer(p, null)} className="px-3 py-2.5 text-sm rounded-lg border border-slate-200 text-slate-600">A new product</button>}
                        <button type="button" onClick={() => skip(p)} className="px-3 py-2.5 text-sm rounded-lg text-slate-500">Skip this one</button>
                    </div>
                </div>
            ))}

            {[...ladders.map(l => ({ key: l.key, title: ladderTitle(l) })), { key: null, title: 'New products' }].map(g => {
                const group = sorted(decide.filter(p => p.ladderKey === g.key))
                return group.length > 0 && (
                    <section key={g.key ?? 'new'} className="space-y-3">
                        <h3 className="font-bold text-[#052d4a] pt-2">{g.title}</h3>
                        {group.map(p => <CompareCard key={p.id} p={p} text={state.text} onToggle={() => toggle(p)} onChoose={choose} onFeatures={f => editFeatures(p, f)} />)}
                    </section>
                )
            })}
            {unchanged.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
                    <p className="font-semibold flex items-center gap-1.5"><Check size={15} className="text-emerald-500" /> No change ({unchanged.length}), marked as confirmed today</p>
                    <ul className="mt-1 text-slate-500">{unchanged.map(p => <li key={p.id}>{packageLabel(p.current!)}</li>)}</ul>
                </div>
            )}
            {cash.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">Cash rewards in the message ({cash.length}), not added to packages</summary><ul className="list-disc pl-5">{cash.map(c => <li key={c}>{c}</li>)}</ul></details>}
            {state.read.ignored.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer py-2">Ignored ({state.read.ignored.length})</summary><ul className="list-disc pl-5">{state.read.ignored.map((i, n) => <li key={n}>{i.text}</li>)}</ul></details>}

            <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-4 flex-wrap">
                {learned.length > 0 && <label className="text-sm text-slate-600 inline-flex items-center gap-2"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember my answers</label>}
                <span className="text-sm text-slate-500">{blocked ? (asks.length ? 'Answer the questions first' : 'Check the unused lines first') : `${ticked.length} ticked${waiting.length ? `, ${waiting.length} not ticked` : ''}`}</span>
                <button type="button" disabled={blocked || !ticked.length} onClick={apply} className="btn-primary px-5 py-2.5 text-sm inline-flex items-center gap-2 disabled:opacity-40">Review final list <ArrowRight size={15} /></button>
            </div>
        </div>
    )
}

/** Same as HUB, nothing to decide. */
const isUnchanged = (p: Proposal) => p.kind === 'same' && p.level === 'green' && p.accepted && !p.featureDiffs.length

const PILL = { change: 'Changed', new: 'New', remove: 'Remove', same: 'No change', ask: '' } as const

/** One package, complete on both sides and lined up row by row. Only differences are coloured. */
function CompareCard({ p, text, onToggle, onChoose, onFeatures }: { p: Proposal; text: string | null; onToggle: () => void; onChoose: (d: FeatureDiff, useBanker: boolean) => void; onFeatures: (f: string[]) => void }) {
    const old = p.current, now = p.proposed
    const pkg = now ?? old!
    const on = p.accepted && p.level !== 'red'
    const lines = text?.split(/\r?\n/) ?? []
    const source = p.item ? [...new Set(p.item.lines)].sort((a, b) => a - b).map(n => lines[n - 1]?.trim()).filter(Boolean) : []

    const yearsOf = (x: MortgagePackage | null) => x?.rate_schedule.filter(e => !e.thereafter).length ?? 0
    const rate = (x: MortgagePackage | null, y: number | null) => {
        const e = x?.rate_schedule.find(r => y == null ? r.thereafter : !r.thereafter && r.year === y)
        return e ? formatRateEntry(e).split(': ').slice(1).join(': ') : ''
    }
    const lock = (x: MortgagePackage | null) => !x ? '' : x.lockin_years ? `${x.lockin_years} year${x.lockin_years > 1 ? 's' : ''}` : 'None'
    const loan = (x: MortgagePackage | null) => !x ? '' : money(Number(x.min_loan_size)) + (x.priority_min_loan != null ? ` (Priority ${money(Number(x.priority_min_loan))})` : '')
    const who = (x: MortgagePackage | null) => !x ? '' : [x.property_type, restrictedTo(x) ? `${restrictedTo(x)} only` : ''].filter(Boolean).join(', ')
    const rows: [string, string, string][] = [
        ...Array.from({ length: Math.max(yearsOf(old), yearsOf(now)) }, (_, i): [string, string, string] => [`Year ${i + 1}`, rate(old, i + 1), rate(now, i + 1)]),
        ['Thereafter', rate(old, null), rate(now, null)],
        ['Min loan', loan(old), loan(now)],
        ['Lock-in', lock(old), lock(now)],
        ['For', who(old), who(now)],
        ...(old?.valid_until || now?.valid_until ? [['Valid until', old?.valid_until ?? '', now?.valid_until ?? ''] as [string, string, string]] : []),
    ]
    const oldFeatures = old?.features ?? [], newFeatures = now?.features ?? []
    // A removed feature keeps its place, so its question shows where the feature was.
    const shown = newFeatures.slice()
    for (const d of p.featureDiffs) if (!shown.includes(d.from) && !(d.to && shown.includes(d.to))) {
        const after = oldFeatures.slice(0, oldFeatures.indexOf(d.from)).filter(x => shown.includes(x)).pop()
        shown.splice(after ? shown.indexOf(after) + 1 : 0, 0, d.from)
    }
    const usesBanker = (d: FeatureDiff) => d.to ? newFeatures.includes(d.to) : !newFeatures.includes(d.from)

    return (
        <div className={`bg-white rounded-2xl border-2 overflow-hidden ${p.level === 'red' ? 'border-red-300' : on ? 'border-emerald-300' : 'border-amber-300'}`}>
            <label className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 ${p.level === 'red' ? '' : 'cursor-pointer'}`}>
                <input type="checkbox" className="w-5 h-5 shrink-0 accent-emerald-600" checked={on} disabled={p.level === 'red'} onChange={onToggle} />
                <span className="font-semibold text-[#052d4a] text-sm flex-1">{money(Number(pkg.min_loan_size))} · {pkg.package_name}</span>
                <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${p.kind === 'remove' ? 'bg-red-50 text-red-700' : p.kind === 'new' ? 'bg-sky-50 text-[#0277a8]' : p.kind === 'change' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{PILL[p.kind]}</span>
            </label>
            {p.warnings.map(w => (
                <p key={w} className={`px-4 py-2 text-sm flex gap-2 ${p.level === 'red' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {w}</p>
            ))}
            {p.level === 'red' && <p className="px-4 py-2 text-sm bg-red-50 text-red-800">This can&apos;t be used as it is. Add it in the Packages tab instead.</p>}
            <table className="w-full text-sm table-fixed">
                <thead>
                    <tr className="text-left text-[11px] uppercase text-slate-400">
                        <th className="w-24 px-4 py-2" />
                        <th className="px-3 py-2 font-semibold">HUB now</th>
                        <th className="px-3 py-2 font-semibold bg-slate-50">New</th>
                    </tr>
                </thead>
                <tbody className="align-top">
                    {rows.map(([label, a, b]) => {
                        const diff = !!old && !!now && a !== b
                        return (
                            <tr key={label} className="border-t border-slate-100">
                                <td className="px-4 py-1.5 text-slate-400 text-xs">{label}</td>
                                <td className={`px-3 py-1.5 ${diff ? 'text-red-600 line-through' : 'text-slate-700'}`}>{a || (old ? '' : 'Not in HUB')}</td>
                                <td className={`px-3 py-1.5 bg-slate-50 ${diff ? 'text-emerald-700 font-bold' : 'text-slate-700'}`}>{now ? b || 'None' : 'Removed'}</td>
                            </tr>
                        )
                    })}
                    <tr className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-400 text-xs">Features</td>
                        <td className="px-3 py-2">
                            <ul className="space-y-1">{oldFeatures.map(x => <li key={x} className={`flex gap-1.5 ${now && !newFeatures.includes(x) ? 'text-red-600 line-through' : 'text-slate-700'}`}><span className="text-slate-300">•</span>{x}</li>)}</ul>
                        </td>
                        <td className="px-3 py-2 bg-slate-50">
                            <ul className="space-y-1">{shown.map(x => {
                                // A feature with a question shows the question in its place.
                                const d = p.featureDiffs.find(q => q.from === x || q.to === x)
                                if (d) return <li key={x}><FeatureChoice d={d} banker={usesBanker(d)} onChoose={onChoose} /></li>
                                return now && p.kind !== 'remove' ? (
                                    <li key={x}><FeatureLine text={x} isNew={!!old && !oldFeatures.includes(x)}
                                        onSave={v => onFeatures(newFeatures.map(f => f === x ? v : f))} onDelete={() => onFeatures(newFeatures.filter(f => f !== x))} /></li>
                                ) : (
                                <li key={x} className={`flex gap-1.5 ${old && !oldFeatures.includes(x) ? 'text-emerald-700 font-bold' : 'text-slate-700'}`}><span className="text-slate-300">•</span>{x}</li>)
                            })}</ul>
                            {now && p.kind !== 'remove' && <AddFeature onAdd={v => onFeatures([...newFeatures, v])} />}
                            
                        </td>
                    </tr>
                </tbody>
            </table>
            {source.length > 0 && (
                <details className="px-4 py-2 border-t border-slate-100 text-xs text-slate-500"><summary className="cursor-pointer py-1">See the banker&apos;s words</summary>
                    <pre className="whitespace-pre-wrap bg-slate-50 rounded-lg p-3 mt-1">{source.join('\n')}</pre>
                </details>
            )}
        </div>
    )
}

/** A feature line you can reword or delete in place. */
function FeatureLine({ text, isNew, onSave, onDelete }: { text: string; isNew: boolean; onSave: (v: string) => void; onDelete: () => void }) {
    const [editing, setEditing] = useState(false)
    if (editing) return <FeatureInput start={text} onDone={v => { setEditing(false); if (v && v !== text) onSave(v) }} />
    return (
        <span className={`group flex items-start gap-1.5 ${isNew ? 'text-emerald-700 font-bold' : 'text-slate-700'}`}>
            <span className="text-slate-300">•</span>
            <span className="flex-1">{text}</span>
            <button type="button" aria-label="Edit wording" onClick={() => setEditing(true)} className="p-1.5 -my-1 text-slate-400 hover:text-[#03a9e7]"><Pencil size={13} /></button>
            <button type="button" aria-label="Delete" onClick={onDelete} className="p-1.5 -my-1 text-slate-400 hover:text-red-500"><X size={13} /></button>
        </span>
    )
}

function AddFeature({ onAdd }: { onAdd: (v: string) => void }) {
    const [open, setOpen] = useState(false)
    if (open) return <div className="mt-1.5"><FeatureInput start="" onDone={v => { setOpen(false); if (v) onAdd(v) }} /></div>
    return <button type="button" onClick={() => setOpen(true)} className="mt-1.5 text-xs font-medium text-[#0277a8] inline-flex items-center gap-1 py-1.5"><Plus size={13} /> Add feature</button>
}

function FeatureInput({ start, onDone }: { start: string; onDone: (v: string) => void }) {
    const [v, setV] = useState(start)
    return (
        <span className="flex gap-1.5">
            <input autoFocus value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onDone(v.trim()); if (e.key === 'Escape') onDone(start) }}
                className="flex-1 px-2.5 py-1.5 text-sm rounded-md border border-[#03a9e7] outline-none" />
            <button type="button" onClick={() => onDone(v.trim())} className="btn-primary px-3 text-xs">Done</button>
        </span>
    )
}

function FeatureChoice({ d, banker, onChoose }: { d: FeatureDiff; banker: boolean; onChoose: (d: FeatureDiff, useBanker: boolean) => void }) {
    return (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                                        <p className="text-xs font-semibold text-amber-900">{d.reason ?? 'The banker\'s message gives a different figure'}. Which should agents see?</p>
                                        {([[false, 'Keep HUB', d.from], [true, d.to ? 'Use banker' : 'Remove it', d.to || 'Not offered on this package']] as const).map(([use, label, words]) => (
                                            <button key={label} type="button" onClick={() => onChoose(d, use)}
                                                className={`w-full text-left rounded-md px-3 py-2 mt-1.5 text-sm border-2 flex gap-2 ${banker === use ? 'border-[#03a9e7] bg-white text-[#052d4a]' : 'border-transparent text-slate-500'}`}>
                                                <span className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border-2 ${banker === use ? 'border-[#03a9e7] bg-[#03a9e7] shadow-[inset_0_0_0_2px_white]' : 'border-slate-300'}`} />
                                                <span><span className="block text-[11px] font-semibold uppercase text-slate-400">{label}</span>{words}</span>
                                            </button>
                                        ))}
                                    </div>
    )
}

/** 1 Message · 2 Compare · 3 Review and publish */
function Steps({ at }: { at: number }) {
    return (
        <ol className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {['Paste message', 'Compare and tick', 'Review and publish'].map((label, i) => (
                <li key={label} className={`flex items-center gap-2 ${i + 1 === at ? 'font-semibold text-[#052d4a]' : 'text-slate-400'}`}>
                    <span className={`w-6 h-6 rounded-full grid place-items-center text-xs ${i + 1 === at ? 'bg-[#052d4a] text-white' : i + 1 < at ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100'}`}>{i + 1 < at ? '✓' : i + 1}</span>{label}
                </li>
            ))}
        </ol>
    )
}

function Note({ children }: { children: React.ReactNode }) {
    return <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /><span>{children}</span></p>
}
