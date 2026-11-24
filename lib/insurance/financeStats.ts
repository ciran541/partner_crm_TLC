/**
 * TLC Dashboard, Payouts and Admin Home — the ONE place admin finance numbers
 * are worked out. Pure (no React, no network); pinned by financeStats.test.ts.
 * Input: finance_overview() / finance_queue() (migration 20261205000000).
 *
 * Rules (agreed 2026-11-23):
 *   - Earned figures count by the month the case was marked Closed Won (SGT).
 *     Paid / received figures count by the date the money moved.
 *   - Year-on-year compares the SAME months while the year is in progress.
 *   - Banks always pay 0.15% of the loan (gross).
 *   - Cash held = bank money received − agents paid, for cases where bank money
 *     is tracked. Cases settled before tracking began are left out of both sides.
 */

export interface ClosedAgg { month: string; agent: string; bank: string; source: string; type: string; cases: number; volume: number; gross: number; agent_share: number; tlc: number; fees: number }
export interface OwedAgg { agent: string; bank?: string; cases: number; amount: number; d30: number; d60: number; older: number }
export interface FinanceOverview {
    agents: { id: string; name: string }[]
    closed: ClosedAgg[]
    payouts: { month: string; agent: string; tracked: boolean; amount: number }[]
    receipts: { month: string; agent: string; bank: string; amount: number }[]
    agent_owed: OwedAgg[]
    bank_owed: OwedAgg[]
    pipeline: { stage: string; agent: string; cases: number; volume: number; tlc: number }[]
    leads: { month: string; agent: string; activated: number; won: number; lost: number }[]
    refi: { month: string; agent: string; cases: number; volume: number; tlc: number }[]
}

/** One row of finance_queue(). */
export interface QueueRow {
    id: string; agent_id: string; agent_name: string; client_name: string | null; case_type: string; bank: string
    closed_on: string; loan: number; gross: number; agent_share: number; tlc_share: number; fee: number
    paid: number; received: number; tracked: boolean; has_lo: boolean
}

const cents = (n: number) => Math.round(n * 100) / 100
const total = <T>(rows: T[], f: (r: T) => number) => cents(rows.reduce((s, r) => s + Number(f(r) || 0), 0))

/** Keep one agent's figures (or everyone's). */
export function forAgent(d: FinanceOverview, agent: string | null): FinanceOverview {
    if (!agent) return d
    const own = <T extends { agent: string }>(rows: T[]) => rows.filter(r => r.agent === agent)
    return {
        agents: d.agents, closed: own(d.closed), payouts: own(d.payouts), receipts: own(d.receipts), agent_owed: own(d.agent_owed),
        bank_owed: own(d.bank_owed), pipeline: own(d.pipeline), leads: own(d.leads), refi: own(d.refi),
    }
}

/** 'YYYY-MM' or 'YYYY' → first and last day; anything else → null (no filter). */
export function monthRangeOf(scope: string | null | undefined): { from: string; to: string } | null {
    if (!scope) return null
    if (/^\d{4}$/.test(scope)) return { from: `${scope}-01-01`, to: `${scope}-12-31` }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(scope)) return null
    const [y, m] = scope.split('-').map(Number)
    return { from: `${scope}-01`, to: `${scope}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` }
}

export interface Period { cases: number; volume: number; average: number | null; gross: number; agentShare: number; tlc: number; fees: number }

function sumPeriod(rows: ClosedAgg[]): Period {
    const cases = rows.reduce((s, r) => s + Number(r.cases), 0)
    const volume = total(rows, r => r.volume)
    return {
        cases, volume, average: cases ? volume / cases : null,
        gross: total(rows, r => r.gross), agentShare: total(rows, r => r.agent_share), tlc: total(rows, r => r.tlc), fees: total(rows, r => r.fees),
    }
}

export interface Comparison { now: Period; before: Period; growthPct: number | null; label: string }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `scope` = 'YYYY' or 'YYYY-MM', against the same period a year earlier. Growth is on TLC revenue. */
export function compare(closed: ClosedAgg[], scope: string, currentMonth: string): Comparison {
    const year = Number(scope.slice(0, 4))
    let now: ClosedAgg[], before: ClosedAgg[], label: string
    if (scope.length === 7) {
        const prev = `${year - 1}${scope.slice(4)}`
        now = closed.filter(r => r.month === scope)
        before = closed.filter(r => r.month === prev)
        label = `vs ${MON[Number(scope.slice(5)) - 1]} ${year - 1}`
    } else {
        const upTo = scope === currentMonth.slice(0, 4) ? currentMonth.slice(5) : '12'
        const within = (y: number) => (r: ClosedAgg) => r.month.startsWith(`${y}-`) && r.month.slice(5) <= upTo
        now = closed.filter(within(year))
        before = closed.filter(within(year - 1))
        label = upTo === '12' ? `vs ${year - 1}` : `Jan–${MON[Number(upTo) - 1]} vs same months ${year - 1}`
    }
    const a = sumPeriod(now), b = sumPeriod(before)
    return { now: a, before: b, growthPct: b.tlc > 0 ? ((a.tlc - b.tlc) / b.tlc) * 100 : null, label }
}

export type Metric = 'tlc' | 'gross' | 'volume' | 'cases'

/** Twelve monthly values for a year. */
export function trend(closed: ClosedAgg[], year: number, metric: Metric): number[] {
    const out = Array<number>(12).fill(0)
    for (const r of closed) if (r.month.startsWith(`${year}-`)) out[Number(r.month.slice(5)) - 1] += Number(r[metric])
    return out.map(cents)
}

const inScope = (month: string, scope: string) => scope === 'all' || month.startsWith(scope)

export interface Breakdown { key: string; cases: number; volume: number; tlc: number }

export function breakdown(closed: ClosedAgg[], by: 'bank' | 'source' | 'type', scope: string): Breakdown[] {
    const map = new Map<string, ClosedAgg[]>()
    for (const r of closed) if (inScope(r.month, scope)) map.set(r[by], [...(map.get(r[by]) ?? []), r])
    return [...map].map(([key, rows]) => { const p = sumPeriod(rows); return { key, cases: p.cases, volume: p.volume, tlc: p.tlc } })
        .sort((a, b) => b.tlc - a.tlc || a.key.localeCompare(b.key))
}

export interface AgentRow { id: string; name: string; cases: number; volume: number; tlc: number; leads: number; won: number; conversionPct: number | null; owed: number }

/** Conversion = leads first activated in the period and won since, like the agent Dashboard. */
export function agentRanking(d: FinanceOverview, scope: string): AgentRow[] {
    return d.agents.map(a => {
        const p = sumPeriod(d.closed.filter(r => r.agent === a.id && inScope(r.month, scope)))
        const leads = d.leads.filter(r => r.agent === a.id && inScope(r.month, scope))
        const activated = leads.reduce((s, r) => s + Number(r.activated), 0)
        const won = leads.reduce((s, r) => s + Number(r.won), 0)
        return {
            id: a.id, name: a.name, cases: p.cases, volume: p.volume, tlc: p.tlc, leads: activated, won,
            conversionPct: activated ? (won / activated) * 100 : null, owed: total(d.agent_owed.filter(r => r.agent === a.id), r => r.amount),
        }
    }).sort((x, y) => y.tlc - x.tlc || y.volume - x.volume || x.name.localeCompare(y.name))
}

export interface Owed { amount: number; cases: number; d30: number; d60: number; older: number }
export function owed(rows: OwedAgg[]): Owed {
    return {
        amount: total(rows, r => r.amount), cases: rows.reduce((s, r) => s + Number(r.cases), 0),
        d30: total(rows, r => r.d30), d60: total(rows, r => r.d60), older: total(rows, r => r.older),
    }
}

/** Bank debt per bank, largest first. */
export function owedByBank(rows: OwedAgg[]): (Owed & { bank: string })[] {
    const banks = [...new Set(rows.map(r => r.bank ?? 'Not set'))]
    return banks.map(bank => ({ bank, ...owed(rows.filter(r => (r.bank ?? 'Not set') === bank)) })).sort((a, b) => b.amount - a.amount)
}

export const moved = (rows: { month: string; amount: number }[], scope: string) => total(rows.filter(r => inScope(r.month, scope)), r => r.amount)

/** All-time, tracked cases only. */
export function cashHeld(d: Pick<FinanceOverview, 'receipts' | 'payouts'>): number {
    return cents(total(d.receipts, r => r.amount) - total(d.payouts.filter(p => p.tracked), r => r.amount))
}

export function pipelineByStage(rows: FinanceOverview['pipeline'], stages: string[]) {
    return stages.map(stage => {
        const own = rows.filter(r => r.stage === stage)
        return { stage, cases: own.reduce((s, r) => s + Number(r.cases), 0), volume: total(own, r => r.volume), tlc: total(own, r => r.tlc) }
    })
}

/** Refinancing revenue by year of lock-in end. Lock-ins already over are grouped as 'past'. */
export function refiByYear(rows: FinanceOverview['refi'], currentMonth: string) {
    const map = new Map<string, { cases: number; volume: number; tlc: number }>()
    for (const r of rows) {
        const key = r.month < currentMonth ? 'past' : r.month.slice(0, 4)
        const v = map.get(key) ?? { cases: 0, volume: 0, tlc: 0 }
        map.set(key, { cases: v.cases + Number(r.cases), volume: cents(v.volume + Number(r.volume)), tlc: cents(v.tlc + Number(r.tlc)) })
    }
    return [...map].map(([key, v]) => ({ key, ...v })).sort((a, b) => (a.key === 'past' ? -1 : b.key === 'past' ? 1 : a.key.localeCompare(b.key)))
}

// ─── Payout queue ────────────────────────────────────────────────────────────

export const agentOutstanding = (r: QueueRow) => cents(r.agent_share - r.paid)
export const bankOutstanding = (r: QueueRow) => (r.tracked ? cents(r.gross - r.received) : 0)

/** Where a case's money has got to on the bank side. */
export function bankState(r: QueueRow): 'untracked' | 'waiting' | 'part' | 'received' | 'over' {
    if (!r.tracked) return 'untracked'
    const out = bankOutstanding(r)
    if (r.received <= 0.005) return r.gross <= 0.005 ? 'received' : 'waiting'
    return out > 0.005 ? 'part' : out < -0.005 ? 'over' : 'received'
}

export interface QueueSplit { ready: QueueRow[]; waiting: QueueRow[]; bankOpen: QueueRow[]; overpaid: QueueRow[] }

/** ready = unpaid agents whose bank money is in; waiting = unpaid, bank money not in. */
export function splitQueue(rows: QueueRow[]): QueueSplit {
    const unpaid = rows.filter(r => agentOutstanding(r) > 0.005)
    const isReady = (r: QueueRow) => ['received', 'over', 'untracked'].includes(bankState(r))
    return {
        ready: unpaid.filter(isReady),
        waiting: unpaid.filter(r => !isReady(r)),
        bankOpen: rows.filter(r => ['waiting', 'part', 'over'].includes(bankState(r))),
        // The agent has been paid more than their share.
        overpaid: rows.filter(r => r.paid > 0.005 && agentOutstanding(r) < -0.005),
    }
}

export function groupByAgent(rows: QueueRow[]) {
    const map = new Map<string, QueueRow[]>()
    for (const r of rows) map.set(r.agent_id, [...(map.get(r.agent_id) ?? []), r])
    return [...map.values()].map(list => ({ id: list[0].agent_id, name: list[0].agent_name, rows: list, total: total(list, agentOutstanding) }))
        .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** CSV for Excel: quoted, and text a spreadsheet would run as a formula is defused. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
    const cell = (v: string | number | null | undefined) => {
        if (typeof v === 'number') return String(v)
        const s = v ?? ''
        return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`
    }
    return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n')
}
