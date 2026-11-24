'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, User } from 'lucide-react'
import Skeleton from '@/components/shared/Skeleton'
import { compact } from '@/components/insurance/shared/MonthPicker'
import { Empty, ErrorBox, PageTitle, Panel, Pill, Tile, day, money, useGet } from '@/components/admin/ui'
import { agentRanking, compare, forAgent, owed, pipelineByStage, type FinanceOverview } from '@/lib/insurance/financeStats'
import { OPEN_STAGES, stageLabel } from '@/lib/insurance/stages'
import { accountLabel, isAdmin } from '@/lib/permissions'
import { todaySgt } from '@/lib/insurance/promotions'
import type { HealthRow } from '@/components/admin/types'
import type { Profile } from '@/lib/types/shared'
import type { PropertyAgentCommissionRow } from '@/lib/types/property'

const LINK = 'min-h-[44px] px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-[#0369a1] inline-flex items-center no-underline'

/** One person: plan, money, production and follow-up health, with links to the detail. */
export default function AdminUserPage() {
    const id = useParams()?.id as string
    const { data: people, error } = useGet<Profile[]>('/api/admin/get-profiles')
    const p = people?.find(x => x.id === id)
    const premium = !!p && !isAdmin(p.role) && p.app_type === 'insurance'
    const property = !!p && !isAdmin(p.role) && p.app_type === 'property'
    return (
        <div className="space-y-5">
            <Link href="/admin/users" className="min-h-[44px] inline-flex items-center gap-1.5 text-sm text-slate-500 no-underline"><ArrowLeft size={15} /> Users</Link>
            {error ? <ErrorBox message={error} /> : !people ? <Skeleton height={300} radius={14} /> : !p ? <ErrorBox message="User not found." /> : (
                <>
                    <PageTitle icon={User} title={p.name || 'Unnamed'} subtitle={`${p.email} · joined ${day(p.created_at)}`}
                        action={<div className="flex gap-2"><Pill tone="blue">{accountLabel(p.role, p.app_type, p.subscription_tier)}</Pill><Pill tone={p.status === 'disabled' ? 'red' : 'green'}>{p.status === 'disabled' ? 'Disabled' : 'Active'}</Pill></div>} />
                    {premium && <PremiumAgent id={id} />}
                    {property && <PropertyAgent id={id} />}
                </>
            )}
        </div>
    )
}

function PremiumAgent({ id }: { id: string }) {
    const { data, error } = useGet<FinanceOverview>('/api/admin/finance/overview')
    const { data: health, error: healthError } = useGet<{ rows: HealthRow[] }>('/api/admin/follow-up-health')
    if (error) return <ErrorBox message={error} />
    if (!data) return <Skeleton height={300} radius={14} />
    const d = forAgent(data, id)
    const month = todaySgt().slice(0, 7)
    const year = month.slice(0, 4)
    const c = compare(d.closed, year, month)
    const o = owed(d.agent_owed)
    const r = agentRanking(data, year).find(a => a.id === id)
    const h = health?.rows.find(x => x.agent === id)
    return (
        <>
            <div className="flex gap-2 flex-wrap">
                <Link className={LINK} href={`/admin/insurance/earnings?agent=${id}`}>Earnings and payouts</Link>
                <Link className={LINK} href={`/admin/insurance/cases?agent=${id}`}>Cases</Link>
                <Link className={LINK} href={`/admin/insurance/follow-ups?agent=${id}`}>Follow-ups</Link>
                <Link className={LINK} href={`/admin/finance?agent=${id}`}>Dashboard</Link>
            </div>
            <Panel title={`This year · ${year}`}>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Tile label="Loans closed" value={compact(c.now.volume)} sub={`${c.now.cases} cases`} />
                    <Tile label="TLC revenue" value={money(c.now.tlc)} sub={c.growthPct == null ? undefined : `${c.growthPct >= 0 ? '+' : ''}${c.growthPct.toFixed(1)}% ${c.label}`} />
                    <Tile label="Agent earned" value={money(c.now.agentShare)} />
                    <Tile label="Conversion" value={r?.conversionPct == null ? '—' : `${r.conversionPct.toFixed(1)}%`} sub={`${r?.won ?? 0} of ${r?.leads ?? 0} leads`} />
                    <Tile label="Owed to agent" value={money(o.amount)} tone={o.amount > 0 ? 'warn' : undefined} sub={`${o.cases} cases`} />
                    {healthError ? <Tile label="Follow-ups" value="?" sub="Couldn't check" tone="bad" /> : <>
                        <Tile label="Overdue follow-ups" value={h ? String(h.overdue) : '…'} tone={h?.overdue ? 'bad' : undefined} sub={h?.oldest ? `oldest from ${day(h.oldest)}` : undefined} />
                        <Tile label="No follow-up date" value={h ? String(h.missing) : '…'} tone={h?.missing ? 'warn' : undefined} />
                        <Tile label="Open cases" value={h ? String(h.open_cases) : '…'} />
                    </>}
                </div>
            </Panel>
            <Panel title="Pipeline">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{pipelineByStage(d.pipeline, OPEN_STAGES).map(s => <Tile key={s.stage} label={stageLabel(s.stage)} value={String(s.cases)} sub={compact(s.volume)} />)}</div>
            </Panel>
        </>
    )
}

function PropertyAgent({ id }: { id: string }) {
    const { data, error } = useGet<{ rows: PropertyAgentCommissionRow[] }>('/api/admin/property/earnings')
    if (error) return <ErrorBox message={error} />
    if (!data) return <Skeleton height={160} radius={14} />
    const r = data.rows.find(x => x.agentId === id)
    return (
        <Panel title="Commission" action={<Link className={LINK} href={`/admin/property/earnings?agent=${id}`}>Earnings</Link>}>
            {!r ? <Empty>No earnings to show.</Empty> : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <Tile label="Cases" value={String(r.caseCount)} /><Tile label="Pending" value={money(r.pending)} /><Tile label="Confirmed" value={money(r.confirmed)} tone={r.confirmed > 0 ? 'warn' : undefined} /><Tile label="Paid" value={money(r.paid)} tone="good" />
                </div>
            )}
        </Panel>
    )
}
