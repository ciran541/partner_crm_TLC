import type { SupabaseClient } from '@supabase/supabase-js'
import { CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION } from './consentVersions'

/**
 * Compares a user's most recent consent record against the current
 * terms/privacy versions. Returns true if they need to re-accept (including
 * if they somehow have no consent record at all).
 */
export async function needsReconsent(supabase: SupabaseClient, userId: string): Promise<boolean> {
    const { data } = await supabase
        .from('user_consents')
        .select('terms_version, privacy_version')
        .eq('user_id', userId)
        .order('accepted_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!data) return true
    return data.terms_version !== CURRENT_TERMS_VERSION || data.privacy_version !== CURRENT_PRIVACY_VERSION
}
