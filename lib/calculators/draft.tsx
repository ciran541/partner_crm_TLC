'use client'

/**
 * Calculator drafts — calculators remember what the agent last typed (like a
 * workflow's auto-saved draft) until they press Reset.
 *
 * Stored in localStorage, per device, under a key that includes the logged-in
 * user's id: the account switcher lets several agents share one iPad, and one
 * agent's client figures must never pre-fill another agent's calculator.
 *
 * Usage — wrap the calculator, then swap `useState` for `useCalcDraft` on the
 * INPUT fields only (never fetched data like SORA):
 *
 *   export default function Page() {
 *       return <CalculatorDraftScope id="amortization" version={1}><Calc /></CalculatorDraftScope>
 *   }
 *   function Calc() {
 *       const [loan, setLoan] = useCalcDraft('loan', '300,000')
 *       ...<CalculatorResetButton />
 *   }
 *
 * Bump `version` whenever a calculator's saved shape changes (a field renamed or
 * retyped) so old drafts are ignored rather than fed into the new code.
 *
 * Hydration: localStorage doesn't exist during the server render, so the scope
 * renders nothing until it's on the client and knows the user. Its children
 * then mount once with useState initialisers reading the draft synchronously —
 * no effect-driven setState, no flash of default values. Reset clears the draft
 * and remounts the children, so every field falls back to its default.
 */

import {
    createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore,
    type Dispatch, type ReactNode, type SetStateAction,
} from 'react'
import { RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'

const PREFIX = 'hub:calc-draft'

interface DraftCtx {
    storageKey: string
    reset: () => void
}

const Ctx = createContext<DraftCtx | null>(null)

function readDraft(storageKey: string): Record<string, unknown> {
    try {
        const raw = localStorage.getItem(storageKey)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function writeField(storageKey: string, field: string, value: unknown) {
    try {
        const draft = readDraft(storageKey)
        draft[field] = value
        localStorage.setItem(storageKey, JSON.stringify(draft))
    } catch {
        // Storage full / blocked (private mode) — the calculator still works, it just won't remember.
    }
}

/** Same rough shape as the default? Guards against a stale draft of a different type. */
function sameShape(a: unknown, b: unknown): boolean {
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b)
    return typeof a === typeof b
}

const noopSubscribe = () => () => {}

export function CalculatorDraftScope({ id, version = 1, children }: {
    id: string
    version?: number
    children: ReactNode
}) {
    const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false)
    const [userId, setUserId] = useState<string | null>(null)
    const [generation, setGeneration] = useState(0)

    useEffect(() => {
        let alive = true
        supabase.auth.getSession().then(({ data }) => {
            if (alive) setUserId(data.session?.user.id ?? 'anon')
        })
        return () => { alive = false }
    }, [])

    const storageKey = `${PREFIX}:v${version}:${userId}:${id}`
    const reset = useCallback(() => {
        try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
        setGeneration(g => g + 1)
    }, [storageKey])

    if (!isClient || !userId) return <div className="min-h-[50vh]" />

    return (
        <Ctx.Provider value={{ storageKey, reset }}>
            <DraftChildren key={generation}>{children}</DraftChildren>
        </Ctx.Provider>
    )
}

function DraftChildren({ children }: { children: ReactNode }) {
    return <>{children}</>
}

/** Drop-in replacement for useState that persists the value into the calculator's draft. */
export function useCalcDraft<T>(field: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
    const ctx = useContext(Ctx)
    if (!ctx) throw new Error('useCalcDraft must be used inside <CalculatorDraftScope>')
    const { storageKey } = ctx

    const [value, setValue] = useState<T>(() => {
        const draft = readDraft(storageKey)
        return field in draft && sameShape(draft[field], initial) ? (draft[field] as T) : initial
    })

    useEffect(() => { writeField(storageKey, field, value) }, [storageKey, field, value])

    return [value, setValue]
}

export function CalculatorResetButton({ className = '' }: { className?: string }) {
    const ctx = useContext(Ctx)
    if (!ctx) return null
    return (
        <button
            type="button"
            onClick={() => {
                if (window.confirm('Reset this calculator? Everything you entered will be cleared.')) ctx.reset()
            }}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 border border-slate-200 bg-white hover:bg-slate-50 hover:text-slate-700 px-3 py-1.5 rounded-lg transition-colors shrink-0 ${className}`}
        >
            <RotateCcw size={12} /> Reset
        </button>
    )
}
