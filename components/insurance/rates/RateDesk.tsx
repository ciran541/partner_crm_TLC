'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ChevronRight, Eye, History, Pencil, Plus, RefreshCcw, RotateCcw, Save, Table2, Trash2, Wand2 } from 'lucide-react'
import { isSoraStale, soraAgeDays } from '@/lib/insurance/rateSchedule'
import type { BankBenchmark, SoraRates } from '@/lib/insurance/sora'
import InlineAlert from '@/components/shared/InlineAlert'
import LoadFailed from '@/components/shared/LoadFailed'
import Modal from '@/components/shared/Modal'
import Spinner from '@/components/shared/Spinner'
import LadderGrid from './LadderGrid'
import { buildLadders, byCategoryAndLoan, issueKey } from '@/lib/insurance/rateLadders'
import SmartUpdate from './SmartUpdate'
import RatePackageEditorModal from './RatePackageEditorModal'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import { todaySgt } from '@/lib/insurance/promotions'
import { isExpired } from '@/lib/insurance/rateFilters'
import { bankChanges, newWarnings, packageErrors, packageLabel, type BankChange, type RateAlias, type RecentSource } from '@/lib/insurance/rateUpdate'
import type { RateSource } from '@/lib/insurance/rateMaster'
import type { MortgagePackage, MortgagePackageInput } from '@/lib/types/rates'

interface Version { id: string; summary: string; source: RateSource | null; changes: BankChange[]; by: string; created_at: string }
interface BankData { packages: MortgagePackage[]; stamp: string; aliases: (RateAlias & { id: string })[]; note: string; recent: RecentSource[]; versions: Version[]; checkedOk: string[] }
type Tab = 'packages' | 'update' | 'history'

const STALE_DAYS = 30

export default function RateDesk() {
    const today = todaySgt()
    const [overview, setOverview] = useState<MortgagePackage[] | null>(null)
    const [overviewFailed, setOverviewFailed] = useState(false)
    const [allChecked, setAllChecked] = useState<Set<string>>(new Set())
    const [noteOpen, setNoteOpen] = useState(false)
    // Features are folded on the Packages tab: rates are what an admin scans for.
    const [showFeatures, setShowFeatures] = useState(false)
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
            const [res, checks] = await Promise.all([fetch('/api/insurance/rates'), fetch('/api/admin/rates/bank')])
            if (!res.ok) throw new Error()
            setOverview((await res.json()).data ?? [])
            // Only hides warnings; if it fails, they all show, which is safe.
            if (checks.ok) setAllChecked(new Set((await checks.json()).checkedOk ?? []))
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

    const leaveOk = () => !dirty || window.confirm('You have changes that are not published. Leave without them?')
    const pickBank = (b: string) => {
        if (!b || b === bank || !leaveOk()) return
        setBank(b); setTab('packages'); setAlert(null); setReviewing(null); setNoteOpen(false); loadBank(b)
        window.scrollTo({ top: 0 })
    }
    const allBanks = () => {
        if (!leaveOk()) return
        setBank(''); setData(null); setReviewing(null); setAlert(null)
    }
    const checkedOk = useMemo(() => new Set(data?.checkedOk ?? []), [data])
    const markChecked = (key: string, ok: boolean) => run(async () => {
        await call('/api/admin/rates/bank', 'PATCH', { bank, checkOk: key, ok })
        setData(d => d && { ...d, checkedOk: ok ? [...d.checkedOk, key] : d.checkedOk.filter(k => k !== key) })
        setAllChecked(s => { const n = new Set(s); if (ok) n.add(key); else n.delete(key); return n })
    })

    const banks = useMemo(() => {
        const m = new Map<string, MortgagePackage[]>()
        for (const p of overview ?? []) m.set(p.bank, [...(m.get(p.bank) ?? []), p])
        return [...m].map(([name, ps]) => {
            const oldest = ps.map(p => p.confirmed_on ?? p.last_updated).sort()[0]
            const toCheck = buildLadders(ps, today).flatMap(l => l.issues).filter(i => i.level === 'check' && !allChecked.has(issueKey(i))).length
            return { name, count: ps.length, oldest, days: Math.floor((Date.parse(today) - Date.parse(oldest)) / 86_400_000), expired: ps.filter(p => isExpired(p, today)).length, toCheck }
        }).sort((a, b) => a.name.localeCompare(b.name))
    }, [overview, today, allChecked])
    const thisBank = banks.find(b => b.name === bank)

    const errors = useMemo(() => {
        const touched = new Set(changes.filter(c => c.type === 'added' || c.type === 'changed').map(c => c.package_id))
        return work.filter(p => touched.has(p.id)).flatMap(p => packageErrors(p).map(e => `${packageLabel(p)}: ${e}`))
    }, [work, changes])
    const warnings = useMemo(() => data && reviewing ? newWarnings(data.packages, work, today, checkedOk) : [], [data, work, today, reviewing, checkedOk])

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
            {!bank ? (
                <>
                    <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
                        <div>
                            <h1 className="ios-page-title">Rates</h1>
                            <p className="page-subtitle">Open a bank to edit its rates or paste what the banker sent. Nothing changes for agents until you publish.</p>
                        </div>
                        <Link href="/admin/insurance/rates/preview" className="btn-ghost px-4 py-2.5 text-sm border border-slate-200 bg-white inline-flex items-center gap-1.5"><Eye size={15} /> View as agent</Link>
                    </div>
                    {alert && <div className="mb-4"><InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} /></div>}
                    <div className="max-w-3xl space-y-4">
                    <Benchmarks onMessage={setAlert} />
                    {overviewFailed ? <LoadFailed message="Couldn't load the banks." onRetry={loadOverview} /> : !overview ? <Spinner size="sm" color="#03a9e7" label="Loading banks…" /> : (
                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                            <div className="grid grid-cols-[1fr_auto_auto_28px] gap-4 px-4 py-2.5 text-[11px] font-semibold uppercase text-slate-400 border-b border-slate-100">
                                <span>Bank</span><span className="w-28">To check</span><span className="w-40">Last confirmed</span><span />
                            </div>
                            {banks.map(b => (
                                <button key={b.name} type="button" onClick={() => pickBank(b.name)} className="w-full grid grid-cols-[1fr_auto_auto_28px] gap-4 items-center px-4 py-3.5 text-left border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                    <span><span className="font-semibold text-[#052d4a]">{b.name}</span> <span className="text-sm text-slate-400">{b.count} packages</span></span>
                                    <span className="w-28 text-sm">
                                        {b.toCheck || b.expired
                                            ? <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><AlertTriangle size={13} /> {[b.toCheck && `${b.toCheck} warning${b.toCheck === 1 ? '' : 's'}`, b.expired && `${b.expired} ended`].filter(Boolean).join(', ')}</span>
                                            : <span className="text-slate-300">–</span>}
                                    </span>
                                    <span className="w-40 text-sm text-slate-600">{fmtDay(b.oldest)} {b.days > STALE_DAYS && <span className="text-amber-700">({b.days} days)</span>}</span>
                                    <ChevronRight size={16} className="text-slate-300" />
                                </button>
                            ))}
                            <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 text-sm text-slate-500 flex-wrap">
                                <Plus size={14} /> A bank not listed yet:
                                <div className="w-56"><InsuranceBankDropdown value="" onChange={pickBank} placeholder="Choose a bank…" /></div>
                            </div>
                        </div>
                    )}
                    </div>
                </>
            ) : (
                <>
                    <button type="button" onClick={allBanks} className="text-sm text-slate-500 hover:text-[#03a9e7] inline-flex items-center gap-1 mb-2 py-1"><ArrowLeft size={14} /> All banks</button>
                    <h1 className="ios-page-title">{bank}</h1>
                    <p className="page-subtitle mb-4">
                        {thisBank ? <>{thisBank.count} packages · last confirmed {fmtDay(thisBank.oldest)}{thisBank.days > STALE_DAYS && <span className="text-amber-700"> ({thisBank.days} days ago)</span>}</> : 'No packages yet'}
                    </p>
                    {alert && !reviewing && <div className="mb-4"><InlineAlert type={alert.type} message={alert.message} onDismiss={() => setAlert(null)} /></div>}
                </>
            )}

            {bank && (failed ? <LoadFailed message={`Couldn't load ${bank}.`} onRetry={() => loadBank(bank)} /> : !data ? <Spinner size="sm" color="#03a9e7" label={`Loading ${bank}…`} /> : (
                <>
                    {reviewing && (
                        <ReviewPage bank={bank} before={data.packages} after={work} changes={changes} today={today} errors={errors} warnings={warnings} checkedOk={checkedOk}
                            note={note.trim() !== data.note ? note.trim() || 'Removed' : null} busy={busy} error={alert?.type === 'error' ? alert.message : null}
                            backLabel={reviewing === 'update' ? 'Back to comparison' : 'Back to editing'} onBack={back} onPublish={publish} />
                    )}
                    <div className={reviewing ? 'hidden' : ''}>
                    <div className="flex gap-1 mb-4 border-b border-slate-200">
                        {([['packages', 'Packages', Table2], ['update', 'Update from banker', Wand2], ['history', 'History', History]] as const).map(([k, label, Icon]) => (
                            <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 py-2.5 text-sm font-semibold inline-flex items-center gap-1.5 border-b-2 -mb-px ${tab === k ? 'border-[#03a9e7] text-[#03a9e7]' : 'border-transparent text-slate-500'}`}><Icon size={15} /> {label}</button>
                        ))}
                    </div>

                    {tab === 'packages' && (
                        <div>
                            <div className="flex flex-wrap gap-2 mb-4">
                                <button type="button" onClick={() => setAdding(true)} className="btn-ghost px-4 py-2.5 text-sm border border-slate-200 inline-flex items-center gap-1.5"><Plus size={15} /> New product</button>
                                <button type="button" onClick={() => setNoteOpen(o => !o)} className="btn-ghost px-4 py-2.5 text-sm border border-slate-200">{data.note ? 'Bank note' : 'Add a bank note'}</button>
                            </div>
                            {(noteOpen || data.note) && (
                                <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
                                    <p className="text-xs font-semibold text-slate-500">Note agents see on every {bank} package</p>
                                    {noteOpen ? (
                                        <div className="flex gap-3 items-end flex-wrap mt-1">
                                            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. Priority Mortgage Plus: deposit $200k for 0.05% off" className="flex-1 min-w-[240px] px-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#03a9e7]" />
                                            <button type="button" disabled={busy || note.trim() === data.note} onClick={async () => { await saveNote(); setNoteOpen(false) }} className="btn-primary px-4 py-2.5 text-sm disabled:opacity-40">Save note</button>
                                        </div>
                                    ) : <p className="text-sm text-slate-700 mt-1 whitespace-pre-line">{data.note}</p>}
                                </div>
                            )}
                            <LadderGrid jumpBar showFeatures={showFeatures} onShowFeatures={setShowFeatures} packages={work} original={data.packages} today={today} checkedOk={checkedOk} onCheckOk={markChecked}
                                onChange={p => setWork(ps => ps.map(x => x.id === p.id ? p : x))}
                                onEdit={setEditing}
                                onAddStep={p => setEditing({ ...p, id: crypto.randomUUID(), min_loan_size: 0, priority_min_loan: null, confirmed_on: today })}
                                onRemove={p => setWork(ps => ps.filter(x => x.id !== p.id))} />
                            {dirty && !reviewing && (
                                <div className="sticky bottom-0 z-30 mt-4 bg-white border border-slate-200 rounded-2xl shadow-lg px-4 py-3 flex items-center justify-end gap-3 flex-wrap">
                                    <span className="text-sm text-slate-500 mr-auto">{changes.length} change{changes.length === 1 ? '' : 's'} not published</span>
                                    <button type="button" onClick={discard} className="btn-ghost px-4 py-2.5 text-sm">Discard</button>
                                    <button type="button" onClick={() => { setReviewing('packages'); window.scrollTo({ top: 0 }) }} className="btn-primary px-5 py-2.5 text-sm inline-flex items-center gap-2"><Save size={15} /> Review and publish</button>
                                </div>
                            )}
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
function ReviewPage({ bank, before, after, changes, today, errors, warnings, checkedOk, note, busy, error, backLabel, onBack, onPublish }: {
    bank: string; before: MortgagePackage[]; after: MortgagePackage[]; changes: BankChange[]; today: string
    errors: string[]; warnings: string[]; checkedOk: Set<string>; note: string | null; busy: boolean; error: string | null
    backLabel: string; onBack: () => void; onPublish: () => void
}) {
    const count = (t: BankChange['type']) => changes.filter(c => c.type === t).length
    // Same order as the list below: Fixed, Floating, BUC, then loan size.
    const pkgFor = (id: string) => after.find(p => p.id === id) ?? before.find(p => p.id === id)!
    const removed = changes.filter(c => c.type === 'removed').sort((a, b) => byCategoryAndLoan(pkgFor(a.package_id), pkgFor(b.package_id)))
    return (
        <div className="space-y-5">
            <div>
                <h2 className="text-lg font-bold text-[#052d4a]">Review {bank} before publishing</h2>
                <div className="flex flex-wrap gap-2 mt-2 text-sm">
                    {([['changed', 'changed', 'bg-sky-50 text-[#0277a8]'], ['added', 'new', 'bg-emerald-50 text-emerald-700'], ['removed', 'removed', 'bg-red-50 text-red-700'], ['confirmed', 'unchanged, confirmed today', 'bg-slate-100 text-slate-600']] as const)
                        .filter(([t]) => count(t)).map(([t, label, cls]) => <span key={t} className={`px-3 py-1 rounded-full font-semibold ${cls}`}>{count(t)} {label}</span>)}
                </div>
            </div>

            {error && <InlineAlert type="error" message={error} />}
            {errors.length > 0 && <Box tone="red" title="Fix these before publishing">{errors.map(e => <p key={e}>{e}</p>)}</Box>}
            {warnings.length > 0 && <Box tone="amber" title="Please check. You can still publish.">{warnings.map(w => <p key={w}>{w}</p>)}</Box>}
            {note && <Box tone="sky" title={`New note on all ${bank} packages`}><p className="whitespace-pre-line">{note}</p></Box>}

            {removed.length > 0 && (
                <Box tone="red" title={`Removed: agents will no longer see ${removed.length === 1 ? 'this package' : `these ${removed.length} packages`}`}>
                    {removed.map(c => <p key={c.package_id}>{c.label}</p>)}
                </Box>
            )}

            <section className="space-y-3">
                <h3 className="font-bold text-[#052d4a]">{bank} after publishing <span className="font-normal text-slate-500">({after.length} packages: changes in green, removed features in red)</span></h3>
                <LadderGrid packages={after} original={before} today={today} checkedOk={checkedOk} />
            </section>

            <div className="sticky bottom-0 z-30 bg-white border border-slate-200 rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between gap-3">
                <button type="button" disabled={busy} onClick={onBack} className="btn-ghost px-4 py-2.5 text-sm border border-slate-200 inline-flex items-center gap-1.5"><ArrowLeft size={15} /> {backLabel}</button>
                <button type="button" disabled={busy || errors.length > 0 || !changes.length} onClick={onPublish} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-40">{busy ? <Spinner size="sm" color="white" label="Publishing…" /> : 'Publish to agents'}</button>
            </div>
        </div>
    )
}

const fmtDay = (d?: string | null) => d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '–'

/**
 * The figures floating rates are priced from: SORA from MAS (daily cron; refresh here if
 * it fails) and banks' own rates such as FHR6, which only an admin can keep current.
 */
function Benchmarks({ onMessage }: { onMessage: (m: { type: 'success' | 'error'; message: string }) => void }) {
    const [sora, setSora] = useState<SoraRates | null>(null)
    const [banks, setBanks] = useState<BankBenchmark[] | null>(null)
    const [failed, setFailed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [editing, setEditing] = useState<string | null>(null)
    const [value, setValue] = useState('')

    const load = useCallback(async () => {
        setFailed(false)
        try {
            const res = await fetch('/api/admin/rates/sora')
            if (!res.ok) throw new Error()
            const json = await res.json()
            setSora(json.sora ?? null); setBanks(Array.isArray(json.benchmarks) ? json.benchmarks : [])
        } catch { setFailed(true) }
    }, [])
    useEffect(() => { load() }, [load])

    const refresh = async () => {
        setBusy(true)
        try {
            const res = await fetch('/api/admin/rates/sora', { method: 'POST' })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Refresh failed')
            setSora(json.sora)
            onMessage({ type: 'success', message: `SORA updated: 1M ${json.sora.comp_sora_1m}% · 3M ${json.sora.comp_sora_3m}%` })
        } catch (e) { onMessage({ type: 'error', message: e instanceof Error ? e.message : 'Refresh failed' }) } finally { setBusy(false) }
    }
    const save = async (key: string) => {
        const v = Number(value)
        if (!value.trim() || !Number.isFinite(v) || v < 0 || v > 20) { onMessage({ type: 'error', message: 'Enter a rate between 0 and 20%.' }); return }
        setBusy(true)
        try {
            const res = await fetch('/api/admin/rates/sora', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value: v }) })
            const json = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(json.error || 'Save failed')
            setBanks(bs => bs?.map(b => b.key === key ? { ...b, value: v, updated_at: new Date().toISOString() } : b) ?? null)
            setEditing(null)
            onMessage({ type: 'success', message: `${key} is now ${v.toFixed(4)}%. Floating rates using it are repriced.` })
        } catch (e) { onMessage({ type: 'error', message: e instanceof Error ? e.message : 'Save failed' }) } finally { setBusy(false) }
    }

    const stale = sora && isSoraStale(sora.value_date)
    const tile = 'rounded-xl border border-slate-200 px-4 py-3 min-w-[150px] flex-1'
    return (
        <section className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                    <h2 className="font-bold text-[#052d4a]">Benchmarks</h2>
                    <p className="text-xs text-slate-500">Floating rates are priced from these.</p>
                </div>
                <button type="button" onClick={refresh} disabled={busy} className="btn-ghost px-3 py-2 text-sm border border-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50">
                    <RefreshCcw size={14} className={busy ? 'animate-spin' : ''} /> Refresh SORA
                </button>
            </div>
            {failed ? <LoadFailed message="Couldn't load the benchmarks." onRetry={load} /> : !banks ? <Spinner size="sm" color="#03a9e7" label="Loading…" /> : (
                <div className="flex flex-wrap gap-3">
                    {([['1M SORA', sora?.comp_sora_1m], ['3M SORA', sora?.comp_sora_3m]] as const).map(([label, v]) => (
                        <div key={label} className={`${tile} ${stale ? 'border-amber-300 bg-amber-50' : ''}`}>
                            <p className="text-[11px] font-semibold uppercase text-slate-400">{label}</p>
                            <p className="text-xl font-bold text-[#052d4a] tabular-nums">{v != null ? `${v.toFixed(4)}%` : '–'}</p>
                            <p className={`text-xs ${stale ? 'text-amber-800 font-semibold' : 'text-slate-500'}`}>
                                {sora ? `MAS, ${fmtDay(sora.published_date ?? sora.value_date)}` : 'Not fetched yet'}{stale ? ` · ${soraAgeDays(sora!.value_date)} days old` : ''}
                            </p>
                        </div>
                    ))}
                    {banks.map(b => (
                        <div key={b.key} className={tile}>
                            <p className="text-[11px] font-semibold uppercase text-slate-400">{b.label || b.key} <span className="normal-case font-normal">(set by the bank)</span></p>
                            {editing === b.key ? (
                                <div className="flex items-center gap-1.5 mt-1">
                                    <input autoFocus inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} aria-label={`${b.key} rate`}
                                        onKeyDown={e => { if (e.key === 'Enter') save(b.key); if (e.key === 'Escape') setEditing(null) }}
                                        className="w-24 px-2 py-1.5 rounded-md border border-[#03a9e7] text-sm outline-none" />
                                    <span className="text-sm text-slate-400">%</span>
                                    <button type="button" disabled={busy} onClick={() => save(b.key)} className="btn-primary px-3 py-1.5 text-xs">Save</button>
                                    <button type="button" onClick={() => setEditing(null)} className="px-2 py-1.5 text-xs text-slate-500">Cancel</button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <p className="text-xl font-bold text-[#052d4a] tabular-nums">{b.value.toFixed(4)}%</p>
                                    <button type="button" aria-label={`Edit ${b.key}`} onClick={() => { setEditing(b.key); setValue(String(b.value)) }} className="p-2 text-slate-400 hover:text-[#03a9e7]"><Pencil size={14} /></button>
                                </div>
                            )}
                            <p className="text-xs text-slate-500">Updated {fmtDay(b.updated_at?.slice(0, 10))}</p>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}

function Box({ tone, title, children }: { tone: 'red' | 'amber' | 'sky'; title: string; children: React.ReactNode }) {
    const cls = { red: 'bg-red-50 border-red-200 text-red-800', amber: 'bg-amber-50 border-amber-200 text-amber-900', sky: 'bg-sky-50 border-sky-200 text-sky-900' }[tone]
    return <div className={`rounded-xl border p-4 text-sm space-y-1 ${cls}`}><p className="font-semibold flex items-center gap-1.5"><AlertTriangle size={15} /> {title}</p>{children}</div>
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
