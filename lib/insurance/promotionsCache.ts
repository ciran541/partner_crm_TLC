import { createAdminClient } from '@/lib/supabase/admin'
import type { BankPromotion } from '@/lib/types/promotions'

/**
 * bank_promotions changes only when an admin ingests or edits one, but it is
 * read on every Step 4 mount and every dashboard load (it rides along with
 * GET /api/insurance/rates). Cache the whole table briefly, same shape as
 * ratesCache.ts — callers filter the cached rows themselves, so staleness only
 * affects how soon a new promotion appears, never the correctness of a match.
 */
const CACHE_MS = 60_000
let cache: { rows: BankPromotion[]; fetchedAt: number } | null = null

/** Called by the admin write routes so an edit is visible immediately. */
export function invalidatePromotionsCache() {
    cache = null
}

export async function loadPromotions(): Promise<BankPromotion[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.rows

    const admin = createAdminClient()
    const { data, error } = await admin
        .from('bank_promotions')
        .select('*')
        .order('ends_on', { ascending: true, nullsFirst: false })
    if (error) throw error

    const rows = (data ?? []) as BankPromotion[]
    cache = { rows, fetchedAt: Date.now() }
    return rows
}
