'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, History, RotateCcw, Save, Table2, Trash2, Wand2 } from 'lucide-react'
import InlineAlert from '@/components/shared/InlineAlert'
import LoadFailed from '@/components/shared/LoadFailed'
import Modal from '@/components/shared/Modal'
import Spinner from '@/components/shared/Spinner'
import LadderGrid from './LadderGrid'
import SmartUpdate from './SmartUpdate'
import RatePackageEditorModal from './RatePackageEditorModal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import { todaySgt } from '@/lib/insurance/promotions'
import { isExpired } from '@/lib/insurance/rateFilters'
import { buildLadders, money } from '@/lib/insurance/rateLadders'
import { bankChanges, ladderTitle, newWarnings, packageErrors, packageLabel, type BankChange, type RateAlias, type RecentSource } from '@/lib/insurance/rateUpdate'
import { formatRateEntry } from '@/lib/insurance/rateSchedule'
import type { RateSource } from '@/lib/insurance/rateMaster'
import type { MortgagePackage, MortgagePackageInput } from '@/lib/types/rates'

interface Version { id: string; summary: string; source: RateSource | null; changes: BankChange[]; by: string; created_at: string }
interface BankData { packages: MortgagePackage[]; stamp: string; aliases: (RateAlias & { id: string })[]; note: string; recent: RecentSource[]; versions: Version[] }
type Tab = 'packages' | 'update' | 'history'

const STALE_DAYS = 30

export default function RateDesk() {
    const today = todaySgt()
    const [overview, setOverview] = useState<MortgagePackage[] | null>(null)
    const [overviewFailed, setOverviewFailed] = useState(false)
    const [bank, setBank] = useState('')
    const [tab, setTab] = useState<Tab>('packages')
    const [data, setData] = useState<BankData | null>(null)
    const [failed, setFailed] = useState(false)
    const [work, setWork] = useState<MortgagePackage[]>([])
    const [pending, setPending] = useState<{ source: RateSource; aliases: RateAlias[] } | null>(null)
    const [note, setNote] = useState('')
    const [editing, setEditing] = useState<MortgagePackage | null>(null)
    const [adding, setAdding] = useState(false)
    const [reviewing, setReviewing] = useState(false)
    const [restoring, setRestoring] = useState<Version | null>(null)
    const [busy, setBusy] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const loadOverview = useCallback(async () => {
        setOverviewFailed(false)
        try {
            const res = await fetch('/api/insurance/rates')
            if (!res.ok) throw new Error()
            setOverview((await res.json()).data ?? [])
        } catch { setOverviewFailed(true) }
    }, [])
    useEffect(() => { loadOverview() }, [loadOverview])

    const loadBank = useCallback(async (b: string) => {
        setData(null); setFailed(false); setPending(null)
        try {
            const res = await fetch(`/api/admin/rates/bank?bank=${encodeURIComponent(b)}`)
            if (!res.ok) throw new Error()
            const json: BankData = await res.json()
            setData(json); setWork(json.packages); setNote(json.note)
        } catch { setFailed(true) }
    }, [])

    const changes = useMemo(() => data ? bankChanges(data.packages, work) : [], [data, work])
    const dirty = changes.length > 0

    useEffect(() => {
        if (!dirty) return
        const warn = (e: BeforeUnloadEvent) => e.preventDefault()
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [dirty])

    const pickBank = (b: string) => {
        if (!b || b === bank) return
        if (dirty && !window.confirm('You have changes that are not published. Leave without them?')) return
        setBank(b); setTab('packages'); setAlert(null); loadBank(b)
    }

    const banks = useMemo(() => {
        const m = new Map<string, MortgagePackage[]>()
        for (const p of overview ?? []) m.set(p.bank, [...(m.get(p.bank) ?? []), p])
        return [...m].map(([name, ps]) => {
            const oldest = ps.map(p => p.confirmed_on ?? p.last_updated).sort()[0]
            return { name, count: ps.length, days: Math.floor((Date.parse(today) - Date.parse(oldest)) / 86_400_000), expired: ps.filter(p => isExpired(p, today)).length }
        }).sort((a, b) => a.name.localeCompare(b.name))
    }, [overview, today])

    const bankers = useMemo(() => [...new Set((data?.versions ?? []).flatMap(v => v.source?.banker ? [v.source.banker] : []))], [data])
    const errors = useMemo(() => {
        const touched = new Set(changes.filter(c => c.type === 'added' || c.type === 'changed').map(c => c.package_id))
        return work.filter(p => touched.has(p.id)).flatMap(p => packageErrors(p).map(e => `${packageLabel(p)}: ${e}`))
    }, [work, changes])
    const warnings = useMemo(() => data && reviewing ? newWarnings(data.packages, work, today) : [], [data, work, today, reviewing])

    const call = async (url: string, method: string, body: object) => {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || 'Something went wrong')
        return json
    }
    const run = async (fn: () => Promise<void>) => {
        setBusy(true); setAlert(null)
        try { await fn() } catch (e) { setAlert({ type: 'error', message: e instanceof Error ? e.message : 'Something went wrong' }) } finally { setBusy(false) }
    }

    const publish = () => run(async () => {
        const n = (t: BankChange['type']) => changes.filter(c => c.type === t).length
        const parts = [[n('changed'), 'changed'], [n('added'), 'added'], [n('removed'), 'removed'], [n('confirmed'), 'confirmed']].filter(([x]) => x).map(([x, w]) => `${x} ${w}`)
        await call('/api/admin/rates/bank', 'PUT', { bank, stamp: data!.stamp, packages: work, summary: parts.join(', '), source: pending?.source, aliases: pending?.aliases })
        // A note found in the message is saved with it.
        if (note.trim() !== data!.note) await call('/api/admin/rates/bank', 'PATCH', { bank, note })
        setReviewing(false); setTab('packages')
        await Promise.all([loadBank(bank), loadOverview()])
        setAlert({ type: 'success', message: `${bank} published: ${parts.join(', ')}. You can undo this in History.` })
    })

    const restore = (v: Version) => run(async () => {
        await call('/api/admin/rates/versions', 'POST', { versionId: v.id, stamp: data!.stamp })
        setRestoring(null)
        await Promise.all([loadBank(bank), loadOverview()])
        setAlert({ type: 'success', message: `${bank} is back to how it was before that update.` })
    })

    const saveNote = () => run(async () => {
        await call('/api/admin/rates/bank', 'PATCH', { bank, note })
        setData(d => d && { ...d, note: note.trim() })
        setAlert({ type: 'success', message: 'Bank note saved.' })
    })

    const forget = (id: string) => run(async () => {
        await call('/api/admin/rates/bank', 'PATCH', { forgetAlias: id })
        setData(d => d && { ...d, aliases: d.aliases.filter(a => a.id !== id) })
    })

    const fromEditor = async (input: MortgagePackageInput) => {
        const base = editing ?? { id: crypto.randomUUID(), first_year_rate: null, last_updated: today, confirmed_on: today }
        const next = { ...base, ...input, bank, features: input.features } as MortgagePackage
        setWork(ps => ps.some(p => p.id === next.id) ? ps.map(p => p.id === next.id ? next : p) : [...ps, next])
        setEditing(null); setAdding(false)
    }

    return (
        <div>
            <Link href="/admin/insurance/rates" className="text-sm text-slate-500 hover:text-[#03a9e7] inline-flex items-center gap-1 mb-2 py-1"><ArrowLeft size={14} /> All packages</Link>
            <h1 className="ios-page-title">Update rates</h1>
            <p className="page-subtitle mb-4">Choose a bank, then edit its rates or paste what the banker sent. Nothing changes for agents until you publish.</p>

            {overviewFailed ? <LoadFailed message="Couldn't load the banks." onRetry={loadOverview} /> : !overview ? <Spinner size="sm" color="#03a9e7" label="Loading banks…" /> : (
                <div className="flex flex-wrap gap-2 mb-4 items-center">
                    {banks.map(b => (
                        <button key={b.name} type="button" onClick={() => pickBank(b.name)} className={`px-3.5 py-2 rounded-xl border text-left text-sm ${bank === b.name ? 'bg-[#052d4a] text-white border-[#052d4a]' : 'bg-white border-slate-200 text-slate-700'}`}>
                            <span className="font-semibold">{b.name}</span> <span className="opacity-60">{b.count}</span>
                            {(b.expired > 0 || b.days > STALE_DAYS) && <span className={`block text-[11px] ${bank === b.name ? 'text-amber-300' : 'text-amber-600'}`}>{b.expired ? `${b.expired} past end date` : `oldest ${b.days} days`}</span>}
                        </button>
                    ))}
                    <div className="w-52"><InsuranceBankDropdown value={bank} onChange={pickBank} placeholder="Another bank…" /></div>
                </div>
            )}
            {alert && <div className="mb-4"><InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} /></div>}

            {bank && (failed ? <LoadFailed message={`Couldn't load ${bank}.`} onRetry={() => loadBank(bank)} /> : !data ? <Spinner size="sm" color="#03a9e7" label={`Loading ${bank}…`} /> : (
                <>
                    <div className="flex gap-1 mb-4 border-b border-slate-200">
                        {([['packages', 'Packages', Table2], ['update', 'Update from banker', Wand2], ['history', 'History', History]] as const).map(([k, label, Icon]) => (
                            <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 -mb-px ${tab === k ? 'border-[#03a9e7] text-[#03a9e7]' : 'border-transparent text-slate-500'}`}><Icon size={15} /> {label}</button>
                        ))}
                    </div>

                    {tab === 'packages' && (
                        <div className={dirty ? 'pb-24' : ''}>
                            <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4 flex gap-3 items-end flex-wrap">
                                <label className="flex-1 min-w-[240px] text-xs font-semibold text-slate-500">Note shown on all {bank} packages
                                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. Priority Mortgage Plus: deposit $200k for 0.05% off" className="w-full mt-1 px-3 py-2 text-sm font-normal rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                                </label>
                                <button type="button" disabled={busy || note.trim() === data.note} onClick={saveNote} className="btn-ghost px-4 py-2.5 text-sm border border-slate-200 disabled:opacity-40">Save note</button>
                                <button type="button" onClick={() => setAdding(true)} className="btn-ghost px-4 py-2.5 text-sm border border-slate-200">New product</button>
                            </div>
                            <LadderGrid packages={work} original={data.packages} today={today}
                                onChange={p => setWork(ps => ps.map(x => x.id === p.id ? p : x))}
                                onEdit={setEditing}
                                onAddStep={p => setEditing({ ...p, id: crypto.randomUUID(), min_loan_size: 0, priority_min_loan: null, confirmed_on: today })}
                                onRemove={p => setWork(ps => ps.filter(x => x.id !== p.id))} />
                        </div>
                    )}

                    {tab === 'update' && (dirty ? (
                        <p className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-600">Publish or discard your current changes first, so the message is compared with what is live.</p>
                    ) : (
                        <SmartUpdate key={data.stamp} bank={bank} packages={data.packages} aliases={data.aliases} recent={data.recent} bankers={bankers} today={today}
                            onApply={(next, source, aliases, notes) => {
                                setWork(next); setPending({ source, aliases }); setTab('packages'); setReviewing(true)
                                if (notes.length && !note.trim()) setNote(notes.join('\n'))
                            }} />
                    ))}

                    {tab === 'history' && (
                        <div className="space-y-3">
                            {!data.versions.length && <p className="text-sm text-slate-400 py-8 text-center">No updates recorded yet. History starts with the first publish.</p>}
                            {data.versions.map(v => (
                                <div key={v.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div>
                                            <p className="text-sm font-semibold text-[#052d4a]">{v.summary}</p>
                                            <p className="text-xs text-slate-500">{new Date(v.created_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })} · {v.by}{v.source?.banker ? ` · from ${v.source.banker}` : ''}</p>
                                        </div>
                                        <button type="button" onClick={() => setRestoring(v)} disabled={dirty || busy} title={dirty ? 'Publish or discard your changes first' : ''} className="btn-ghost px-3 py-2 text-xs border border-slate-200 inline-flex items-center gap-1 disabled:opacity-40"><RotateCcw size={13} /> Undo to before this</button>
                                    </div>
                                    <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer py-1">Changes ({v.changes.length})</summary><ChangeList changes={v.changes} /></details>
                                    {v.source?.text && <details className="text-xs text-slate-600"><summary className="cursor-pointer py-1">Original message</summary><pre className="whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{v.source.text}</pre></details>}
                                    {v.source?.file_path && <a href={`/api/admin/rates/versions?source=${v.id}`} target="_blank" rel="noreferrer" className="text-xs text-[#0277a8] underline">Open {v.source.file_name ?? 'original file'}</a>}
                                </div>
                            ))}
                            {data.aliases.length > 0 && (
                                <div className="bg-white rounded-2xl border border-slate-200 p-4">
                                    <p className="text-sm font-semibold text-[#052d4a] mb-1">Remembered answers</p>
                                    {data.aliases.map(a => (
                                        <div key={a.id} className="flex items-center justify-between text-xs text-slate-600 py-1">
                                            <span>{a.banker ? `${a.banker}: ` : ''}&ldquo;{a.phrase.split('|').pop()}&rdquo; means {a.ladder_key.split('|').slice(2).join(', ')}</span>
                                            <button type="button" aria-label="Forget" onClick={() => forget(a.id)} disabled={busy} className="p-2 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </>
            ))}

            {dirty && tab === 'packages' && (
                <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-3">
                    <span className="text-sm text-slate-500">{changes.length} change{changes.length === 1 ? '' : 's'} not published</span>
                    <button type="button" onClick={() => { setWork(data!.packages); setPending(null); setNote(data!.note) }} className="btn-ghost px-4 py-2.5 text-sm">Discard</button>
                    <button type="button" onClick={() => setReviewing(true)} className="btn-primary px-5 py-2.5 text-sm inline-flex items-center gap-2"><Save size={15} /> Review and publish</button>
                </div>
            )}

            {reviewing && data && (
                <Modal title={`Publish ${bank}`} size="xl" onClose={() => !busy && setReviewing(false)}>
                    <div className="space-y-4">
                        {alert?.type === 'error' && <InlineAlert type="error" message={alert.message} onDismiss={() => setAlert(null)} />}
                        {errors.length > 0 && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800"><p className="font-semibold">Fix before publishing</p>{errors.map(e => <p key={e}>{e}</p>)}</div>}
                        {note.trim() !== data.note && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 whitespace-pre-line">Bank note agents will see: {note.trim() || 'removed'}</p>}
                        {warnings.length > 0 && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800"><p className="font-semibold">Please check. You can still publish.</p>{warnings.map(w => <p key={w}>{w}</p>)}</div>}
                        <div><p className="text-sm font-semibold text-[#052d4a] mb-1">What changes</p><ChangeList changes={changes} /></div>
                        <div>
                            <p className="text-sm font-semibold text-[#052d4a] mb-1">The full {bank} list after publishing ({work.length})</p>
                            <div className="max-h-72 overflow-y-auto border border-slate-100 rounded-lg p-3 space-y-2 text-xs text-slate-600">
                                {buildLadders(work, today).map(l => (
                                    <div key={l.key}><p className="font-semibold text-slate-700">{ladderTitle(l)} · {l.category}</p>
                                        {l.steps.map(s => <p key={s.id} className={changes.some(c => c.package_id === s.id && c.type !== 'confirmed') ? 'bg-sky-50 font-medium' : ''}>{money(Number(s.min_loan_size))}: {s.rate_schedule.map(formatRateEntry).join(' · ')}{s.status === 'draft' ? ' (draft)' : ''}</p>)}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button type="button" disabled={busy} onClick={() => setReviewing(false)} className="btn-ghost px-4 py-2.5 text-sm">Keep editing</button>
                            <button type="button" disabled={busy || errors.length > 0 || !dirty} onClick={publish} className="btn-primary px-5 py-2.5 text-sm disabled:opacity-40">{busy ? <Spinner size="sm" color="white" label="Publishing…" /> : 'Publish to agents'}</button>
                        </div>
                    </div>
                </Modal>
            )}
            {restoring && (
                <Modal title="Undo this update?" onClose={() => !busy && setRestoring(null)}>
                    {alert?.type === 'error' && <InlineAlert type="error" message={alert.message} onDismiss={() => setAlert(null)} />}
                    <p className="text-sm text-slate-600">All {bank} packages go back to how they were just before &ldquo;{restoring.summary}&rdquo;. Any later updates to {bank} are undone too. This is recorded in History, so it can be reversed.</p>
                    <div className="flex justify-end gap-3 mt-4">
                        <button type="button" disabled={busy} onClick={() => setRestoring(null)} className="btn-ghost px-4 py-2.5 text-sm">Cancel</button>
                        <button type="button" disabled={busy} onClick={() => restore(restoring)} className="btn-primary px-5 py-2.5 text-sm">{busy ? <Spinner size="sm" color="white" label="Restoring…" /> : 'Undo'}</button>
                    </div>
                </Modal>
            )}
            {(editing || adding) && <RatePackageEditorModal initial={editing} defaultBank={bank} lockBank saving={false} onSave={fromEditor} onClose={() => { setEditing(null); setAdding(false) }} />}
        </div>
    )
}

function ChangeList({ changes }: { changes: BankChange[] }) {
    const confirmed = changes.filter(c => c.type === 'confirmed').length
    const colour = { added: 'text-emerald-700', changed: 'text-[#0277a8]', removed: 'text-red-700', confirmed: '' }
    return (
        <div className="space-y-1.5 text-xs">
            {changes.filter(c => c.type !== 'confirmed').map(c => (
                <div key={c.type + c.package_id}>
                    <p className={`font-semibold ${colour[c.type]}`}>{c.type === 'added' ? 'Add' : c.type === 'removed' ? 'Remove' : 'Change'}: {c.label}</p>
                    {c.type === 'changed' && c.diffs.map(d => <p key={d.field} className="pl-3 text-slate-600">{d.field}: <span className="line-through text-slate-400">{d.from}</span> → {d.to}</p>)}
                </div>
            ))}
            {confirmed > 0 && <p className="text-slate-500">{confirmed} unchanged, marked as confirmed</p>}
        </div>
    )
}
