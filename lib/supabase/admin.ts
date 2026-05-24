import { createClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase admin client.
 * Bypasses RLS — ONLY use in server-side API routes, never in browser code.
 * Call createAdminClient() per-request — do not create a singleton.
 */
export function createAdminClient() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}
