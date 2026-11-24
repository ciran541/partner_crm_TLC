'use client'

import { useCallback, useEffect, useState, type ElementType, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

/** Small pieces shared by every admin screen, so they look and read the same. */

/** $1,620 / $1,147.50 / −$25. */
export function money(n: number | null | undefined): string {
    const v = Number(n ?? 0)
    const whole = Math.abs(v - Math.round(v)) < 0.005
    return new Intl.NumberFormat('en-SG', {
        style: 'currency', currency: 'SGD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    }).format(v)
}

/** 'YYYY-MM-DD' → 23 Nov 2026. */
export function day(d: string | null | undefined): string {
    if (!d) return '—'
    return new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Timestamp → 23 Nov 2026, 4:05 pm (Singapore). */
export function when(iso: string): string {
    return new Date(iso).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export async function postJson<T = unknown>(url: string, body: unknown, method = 'POST'): Promise<T> {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.error || 'Something went wrong. Please try again.')
    return d as T
}

/** GET with loading, error and reload. The previous data stays on screen while it reloads. */
export function useGet<T>(url: string | null) {
    const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null })
    const [n, setN] = useState(0)
    useEffect(() => {
        if (!url) return
        let alive = true
        fetch(url)
            .then(async r => {
                const d = await r.json().catch(() => ({}))
                if (!r.ok) throw new Error(d.error || 'Could not load this. Please refresh.')
                return d as T
            })
            .then(d => { if (alive) setState({ url, data: d, error: null }) })
            .catch(e => { if (alive) setState(s => ({ url, data: s.url === url ? s.data : null, error: e instanceof Error ? e.message : 'Could not load this.' })) })
        return () => { alive = false }
    }, [url, n])
    const reload = useCallback(() => setN(x => x + 1), [])
    return { data: state.data, error: state.error, reload, loading: !!url && state.url !== url }
}

export function PageTitle({ icon: Icon, title, subtitle, action }: { icon: ElementType; title: string; subtitle?: ReactNode; action?: ReactNode }) {
    return (
        <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
                <h1 className="ios-page-title flex items-center gap-2"><Icon size={24} className="text-[#03a9e7]" /> {title}</h1>
                {subtitle && <p className="page-subtitle">{subtitle}</p>}
            </div>
            {action}
        </div>
    )
}

export function Panel({ title, subtitle, action, children }: { title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="card p-4 sm:p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-base font-bold text-[#052d4a]">{title}</h2>
                    {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
                </div>
                {action}
            </div>
            {children}
        </section>
    )
}

export function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
    const color = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-red-600' : 'text-[#052d4a]'
    return (
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3.5">
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={`text-2xl font-extrabold mt-1.5 leading-none tracking-tight ${color}`}>{value}</p>
            {sub && <p className="text-[11px] text-slate-500 mt-1.5">{sub}</p>}
        </div>
    )
}

export function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'grey'; children: ReactNode }) {
    const c = { green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-600', blue: 'bg-sky-50 text-[#0369a1]', grey: 'bg-slate-100 text-slate-500' }[tone]
    return <span className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${c}`}>{children}</span>
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void }) {
    return (
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 overflow-x-auto" role="tablist">
            {tabs.map(t => (
                <button key={t.key} type="button" role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
                    className={`min-h-[44px] px-4 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${value === t.key ? 'bg-white text-[#052d4a] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {t.label}{t.count != null && <span className="ml-1.5 text-xs text-slate-400">{t.count}</span>}
                </button>
            ))}
        </div>
    )
}

export function ErrorBox({ message }: { message: string }) {
    return <div role="alert" className="card p-4 flex items-center gap-2 text-red-600 text-sm"><AlertCircle size={16} className="shrink-0" />{message}</div>
}

export function Empty({ children }: { children: ReactNode }) {
    return <p className="text-sm text-slate-500 text-center py-8">{children}</p>
}

export const FIELD = 'h-11 px-3 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/20'
