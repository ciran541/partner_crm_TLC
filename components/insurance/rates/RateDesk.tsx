'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, History, RotateCcw, Save, Table2, Trash2, Wand2 } from 'lucide-react'
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
import { bankChanges, newWarnings, packageErrors, packageLabel, type BankChange, type RateAlias, type RecentSource } from '@/lib/insurance/rateUpdate'
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
    // Where the review was opened from, so Back returns there with nothing lost.
    const [reviewing, setReviewing] = useState<Tab | null>(null)
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
        setReviewing(null); setTab('packages')
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

    const back = () => {
        // From an update: back to the comparison, which still has your ticks.
        if (reviewing === 'update') { setWork(data!.packages); setPending(null); setNote(data!.note) }
        setReviewing(null); setAlert(null)
    }
    const discard = () => { setWork(data!.packages); setPending(null); setNote(data!.note) }

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
                    {reviewing && (
                        <ReviewPage bank={bank} before={data.packages} after={work} changes={changes} today={today} errors={errors} warnings={warnings}
                            note={note.trim() !== data.note ? note.trim() || 'Removed' : null} busy={busy}
                            backLabel={reviewing === 'update' ? 'Back to comparison' : 'Back to editing'} onBack={back} onPublish={publish} />
                    )}
                    <div className={reviewing ? 'hidden' : ''}>
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

                    {tab === 'update' && dirty && !reviewing && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-600">
                            <p>You have {changes.length} unpublished change{changes.length === 1 ? '' : 's'} in Packages. Publish or discard them first, so the message is compared with what agents see now.</p>
                            <div className="flex gap-3 mt-3">
                                <button type="button" onClick={discard} className="btn-ghost px-4 py-2.5 text-sm border border-slate-200">Discard them</button>
                                <button type="button" onClick={() => setReviewing('packages')} className="btn-primary px-5 py-2.5 text-sm">Review and publish them</button>
                            </div>
                        </div>
                    )}
                    {/* Kept mounted, so going back from the review keeps every tick and answer. */}
                    <div className={tab === 'update' && (!dirty || reviewing) ? '' : 'hidden'}>
                        <SmartUpdate key={data.stamp} bank={bank} packages={data.packages} aliases={data.aliases} recent={data.recent} today={today}
                            onApply={(next, source, aliases, notes) => {
                                setWork(next); setPending({ source, aliases }); setReviewing('update'); setAlert(null)
                                if (notes.length && !note.trim()) setNote(notes.join('\n'))
                                window.scrollTo({ top: 0 })
                            }} />
                    </div>

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
                    </div>
                </>
            ))}

            {dirty && tab === 'packages' && !reviewing && (
                <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-3">
                    <span className="text-sm text-slate-500">{changes.length} change{changes.length === 1 ? '' : 's'} not published</span>
                    <button type="button" onClick={discard} className="btn-ghost px-4 py-2.5 text-sm">Discard</button>
                    <button type="button" onClick={() => { setReviewing('packages'); window.scrollTo({ top: 0 }) }} className="btn-primary px-5 py-2.5 text-sm inline-flex items-center gap-2"><Save size={15} /> Review and publish</button>
                </div>
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

/** Step 3: everything that will change, and the bank as agents will see it. Full page, not a popup. */
function ReviewPage({ bank, before, after, changes, today, errors, warnings, note, busy, backLabel, onBack, onPublish }: {
    bank: string; before: MortgagePackage[]; after: MortgagePackage[]; changes: BankChange[]; today: string
    errors: string[]; warnings: string[]; note: string | null; busy: boolean; backLabel: string; onBack: () => void; onPublish: () => void
}) {
    const count = (t: BankChange['type']) => changes.filter(c => c.type === t).length
    const real = changes.filter(c => c.type !== 'confirmed')
    return (
        <div className="space-y-5 pb-28">
            <div>
                <h2 className="text-lg font-bold text-[#052d4a]">Review {bank} before publishing</h2>
                <div className="flex flex-wrap gap-2 mt-2 text-sm">
                    {([['changed', 'changed', 'bg-sky-50 text-[#0277a8]'], ['added', 'new', 'bg-emerald-50 text-emerald-700'], ['removed', 'removed', 'bg-red-50 text-red-700'], ['confirmed', 'unchanged, confirmed today', 'bg-slate-100 text-slate-600']] as const)
                        .filter(([t]) => count(t)).map(([t, label, cls]) => <span key={t} className={`px-3 py-1 rounded-full font-semibold ${cls}`}>{count(t)} {label}</span>)}
                </div>
            </div>

            {errors.length > 0 && <Box tone="red" title="Fix these before publishing">{errors.map(e => <p key={e}>{e}</p>)}</Box>}
            {warnings.length > 0 && <Box tone="amber" title="Please check. You can still publish.">{warnings.map(w => <p key={w}>{w}</p>)}</Box>}
            {note && <Box tone="sky" title={`New note on all ${bank} packages`}><p className="whitespace-pre-line">{note}</p></Box>}

            {real.length > 0 && (
                <section className="space-y-3">
                    <h3 className="font-bold text-[#052d4a]">What changes</h3>
                    {real.map(c => <ChangeCard key={c.type + c.package_id} c={c} />)}
                </section>
            )}

            <section className="space-y-3">
                <h3 className="font-bold text-[#052d4a]">{bank} after publishing <span className="font-normal text-slate-500">({after.length} packages, changes in green)</span></h3>
                <LadderGrid packages={after} original={before} today={today} />
            </section>

            <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
                <button type="button" disabled={busy} onClick={onBack} className="btn-ghost px-4 py-2.5 text-sm border border-slate-200 inline-flex items-center gap-1.5"><ArrowLeft size={15} /> {backLabel}</button>
                <button type="button" disabled={busy || errors.length > 0 || !changes.length} onClick={onPublish} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-40">{busy ? <Spinner size="sm" color="white" label="Publishing…" /> : 'Publish to agents'}</button>
            </div>
        </div>
    )
}

function Box({ tone, title, children }: { tone: 'red' | 'amber' | 'sky'; title: string; children: React.ReactNode }) {
    const cls = { red: 'bg-red-50 border-red-200 text-red-800', amber: 'bg-amber-50 border-amber-200 text-amber-900', sky: 'bg-sky-50 border-sky-200 text-sky-900' }[tone]
    return <div className={`rounded-xl border p-4 text-sm space-y-1 ${cls}`}><p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={15} /> {title}</p>{children}</div>
}

/** One changed package: only the rows that change, before and after. */
function ChangeCard({ c }: { c: BankChange }) {
    const pill = { added: ['New', 'bg-emerald-50 text-emerald-700'], changed: ['Changed', 'bg-sky-50 text-[#0277a8]'], removed: ['Removed', 'bg-red-50 text-red-700'], confirmed: ['', ''] }[c.type]
    const rows = c.type === 'added' ? c.diffs.filter(d => d.to && d.to !== 'none') : c.diffs
    return (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
                <span className="font-semibold text-sm text-[#052d4a] flex-1">{c.label}</span>
                <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${pill[1]}`}>{pill[0]}</span>
            </div>
            {c.type === 'removed' ? <p className="px-4 py-3 text-sm text-red-700">Agents will no longer see this package.</p> : (
                <table className="w-full text-sm table-fixed">
                    {c.type === 'changed' && <thead><tr className="text-left text-[11px] uppercase text-slate-400"><th className="w-32 px-4 py-2" /><th className="px-3 py-2 font-semibold">Before</th><th className="px-3 py-2 font-semibold bg-slate-50">After</th></tr></thead>}
                    <tbody className="align-top">
                        {rows.map(d => (
                            <tr key={d.field} className="border-t border-slate-100">
                                <td className="px-4 py-1.5 text-xs text-slate-400 capitalize">{d.field}</td>
                                {c.type === 'changed' && <td className="px-3 py-1.5 text-red-600 line-through"><Lines text={d.from} /></td>}
                                <td className={`px-3 py-1.5 bg-slate-50 ${c.type === 'changed' ? 'text-emerald-700 font-bold' : 'text-slate-700'}`}><Lines text={d.to} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

/** Features arrive one per line: show them as a list. */
function Lines({ text }: { text: string }) {
    const lines = text.split('\n')
    if (lines.length === 1) return <>{text}</>
    return <ul className="space-y-1">{lines.map(l => <li key={l} className="flex gap-1.5"><span className="opacity-40">•</span>{l}</li>)}</ul>
}

function ChangeList({ changes }: { changes: BankChange[] }) {
    const confirmed = changes.filter(c => c.type === 'confirmed').length
    const colour = { added: 'text-emerald-700', changed: 'text-[#0277a8]', removed: 'text-red-700', confirmed: '' }
    return (
        <div className="space-y-1.5 text-xs">
            {changes.filter(c => c.type !== 'confirmed').map(c => (
                <div key={c.type + c.package_id}>
                    <p className={`font-semibold ${colour[c.type]}`}>{c.type === 'added' ? 'Add' : c.type === 'removed' ? 'Remove' : 'Change'}: {c.label}</p>
                    {c.type === 'changed' && c.diffs.map(d => <p key={d.field} className="pl-3 text-slate-600">{d.field}: <span className="line-through text-slate-400">{d.from.replace(/\n/g, '; ')}</span> → {d.to.replace(/\n/g, '; ')}</p>)}
                </div>
            ))}
            {confirmed > 0 && <p className="text-slate-500">{confirmed} unchanged, marked as confirmed</p>}
        </div>
    )
}
