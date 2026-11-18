import type { SupabaseClient } from '@supabase/supabase-js'
import { mobileKey } from '@/lib/insurance/caseIntake'

/** Active bank names, in display order — dropdown source and spelling canon for intake. */
export async function loadBankNames(db: SupabaseClient): Promise<string[]> {
    const { data } = await db.from('banks').select('name').eq('is_active', true).order('sort_order')
    return (data ?? []).map(b => b.name as string)
}

/**
 * The caller's existing clients keyed by mobileKey() → case id. Scoped to the
 * caller's OWN cases: duplicates are about "do I already have this client",
 * and another agent having the same client is none of this agent's business.
 */
export async function ownMobileIndex(db: SupabaseClient, userId: string): Promise<Map<string, { id: string; name: string | null }>> {
    const index = new Map<string, { id: string; name: string | null }>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
            .from('cases')
            .select('id, client_name, client_mobile')
            .eq('created_by', userId)
            .not('client_mobile', 'is', null)
            .range(from, from + PAGE - 1)
        if (error) throw new Error(error.message)
        for (const c of data ?? []) {
            const key = mobileKey(c.client_mobile)
            if (key && !index.has(key)) index.set(key, { id: c.id, name: c.client_name })
        }
        if (!data || data.length < PAGE) break
    }
    return index
}
