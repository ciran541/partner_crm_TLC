import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { todaySgt } from '@/lib/insurance/promotions'
import { addDays } from '@/lib/insurance/followUps'
import { isSoraStale } from '@/lib/insurance/rateSchedule'

export const dynamic = 'force-dynamic'

/**
 * GET — Admin Home: what needs doing. A source that fails comes back null
 * ("couldn't check"), never zero: an empty list must mean nothing to do.
 */
export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const db = createAdminClient()
    const today = todaySgt()
    const head = { count: 'exact' as const, head: true }

    const [queue, overview, health, reports, drafts, gaps, invites, promos, sora, promoDrafts, officialPages, officialDrafts] = await Promise.all([
        db.rpc('finance_queue'),
        db.rpc('finance_overview'),
        db.rpc('agent_follow_up_health'),
        db.from('bank_intelligence_reports').select('id', head).eq('is_published', false).eq('hidden', false),
        db.from('mortgage_packages').select('id', head).eq('status', 'draft'),
        db.from('knowledge_gaps').select('id', head).eq('status', 'open').or('kind.eq.gap,rating.eq.-1'),
        db.from('agent_invites').select('id', head).eq('status', 'pending').gt('expires_at', new Date().toISOString()),
        db.from('bank_promotions').select('id, bank, title, ends_on').eq('status', 'published').gte('ends_on', today).lte('ends_on', addDays(today, 7)).order('ends_on'),
        db.from('sora_rates').select('value_date').order('value_date', { ascending: false }).limit(1).maybeSingle(),
        db.from('bank_promotions').select('id', head).eq('status', 'draft'),
        db.from('official_pages').select('id', head).in('status', ['changed', 'failed', 'blocked']),
        db.from('knowledge_articles').select('id', head).eq('status', 'draft').not('official_page_id', 'is', null),
    ])
    for (const r of [queue, overview, health, reports, drafts, gaps, invites, promos, sora, promoDrafts, officialPages, officialDrafts]) {
        if (r.error) console.error('[admin/home]', r.error)
    }
    const count = (r: { error: unknown; count: number | null }) => (r.error ? null : r.count ?? 0)
    return NextResponse.json({
        today,
        queue: queue.error ? null : queue.data,
        overview: overview.error ? null : overview.data,
        health: health.error ? null : health.data,
        todo: {
            reports: count(reports), packageDrafts: count(drafts), promoDrafts: count(promoDrafts), gaps: count(gaps), invites: count(invites),
            officialPages: count(officialPages), officialDrafts: count(officialDrafts),
            promosEnding: promos.error ? null : promos.data,
            sora: sora.error ? null : { date: sora.data?.value_date ?? null, stale: !sora.data || isSoraStale(sora.data.value_date) },
        },
    })
}
