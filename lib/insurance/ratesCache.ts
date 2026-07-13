import { createAdminClient } from '@/lib/supabase/admin'
import type { MortgagePackage } from '@/lib/types/rates'

/**
 * mortgage_packages only changes via admin edit/ingestion — cache the full
 * table in memory for a short window so every workflow-engine mount (which
 * calls GET /api/insurance/rates on every Step 4 visit) doesn't re-query it.
 * Callers filter the cached rows themselves, so cache staleness only affects
 * "how soon a new admin edit is visible," never the correctness of a given
 * request's filters. Best-effort on serverless — a cold start just misses.
 */
const CACHE_MS = 60_000
let packagesCache: { rows: MortgagePackage[]; fetchedAt: number } | null = null

/** Called by admin create/update/delete/replace/publish routes so an edit is
 *  visible immediately instead of waiting out the cache window. */
export function invalidatePackagesCache() {
    packagesCache = null
}

export async function loadPackages(): Promise<MortgagePackage[]> {
    if (packagesCache && Date.now() - packagesCache.fetchedAt < CACHE_MS) {
        return packagesCache.rows
    }
    const admin = createAdminClient()
    const { data, error } = await admin
        .from('mortgage_packages')
        .select('*')
        .order('bank', { ascending: true })
        .order('first_year_rate', { ascending: true, nullsFirst: false })
    if (error) throw error
    const rows = (data ?? []) as MortgagePackage[]
    packagesCache = { rows, fetchedAt: Date.now() }
    return rows
}
