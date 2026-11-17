/**
 * Invite-only signup — shared by BOTH signup routes (`/api/insurance/signup`,
 * `/api/property/signup`) and the admin invite route.
 *
 * TLC HUB has no public signup: an admin generates a single-use link after
 * payment is confirmed offline, and the invite row alone decides the plan.
 * Every token check goes through `loadValidInvite()` with the app the caller
 * is signing up for, so an invite made for one app can never be redeemed on
 * the other (e.g. a Starter link pasted into the Premium signup page).
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import type { AppType, SubscriptionTier } from '@/lib/types/shared'
import { PLAN_NAMES, type PlanName } from '@/lib/permissions'

type AdminClient = ReturnType<typeof createAdminClient>

export type InvitePlan = 'premium' | 'basic' | 'starter'

export interface InviteTarget {
    app_type: AppType
    /** Property invites only; null for insurance (Premium). */
    subscription_tier: SubscriptionTier | null
}

/** Plan picked in the admin UI → what gets stored on the invite (and later the profile). */
export function inviteTargetForPlan(plan: InvitePlan): InviteTarget {
    switch (plan) {
        case 'premium': return { app_type: 'insurance', subscription_tier: null }
        case 'basic':   return { app_type: 'property',  subscription_tier: 'premium' }
        case 'starter': return { app_type: 'property',  subscription_tier: 'standard' }
    }
}

export function isInvitePlan(v: unknown): v is InvitePlan {
    return v === 'premium' || v === 'basic' || v === 'starter'
}

/** Display name for an invite row (Premium / Basic / Starter). */
export function invitePlanName(invite: { app_type: string; subscription_tier?: string | null }): PlanName {
    if (invite.app_type === 'insurance') return PLAN_NAMES.insurance
    return invite.subscription_tier === 'premium' ? PLAN_NAMES.propertyPremium : PLAN_NAMES.propertyStandard
}

/** Where the invitee completes signup — each app keeps its own signup page. */
export function inviteSignupPath(appType: string): string {
    return appType === 'property' ? '/property/signup' : '/insurance/signup'
}

export type InviteRejectReason = 'not_found' | 'wrong_app' | 'used_or_revoked' | 'expired'

/**
 * Returns the invite only if it is pending, unexpired, and was issued for
 * `appType`. Callers must still check the signup email against
 * `invite.invited_email` (required on every invite).
 */
export async function loadValidInvite(supabaseAdmin: AdminClient, token: string, appType: AppType) {
    const { data: invite } = await supabaseAdmin
        .from('agent_invites')
        .select('*')
        .eq('token', token)
        .single()

    if (!invite) return { invite: null, reason: 'not_found' as InviteRejectReason }
    if (invite.app_type !== appType) return { invite: null, reason: 'wrong_app' as InviteRejectReason }
    if (invite.status !== 'pending') return { invite: null, reason: 'used_or_revoked' as InviteRejectReason }
    if (new Date(invite.expires_at).getTime() < Date.now()) return { invite: null, reason: 'expired' as InviteRejectReason }

    return { invite, reason: null }
}

/** Mark an invite used — single-use. Only flips a still-pending row. */
export async function burnInvite(supabaseAdmin: AdminClient, inviteId: string, userId: string) {
    const { error } = await supabaseAdmin
        .from('agent_invites')
        .update({ status: 'used', used_at: new Date().toISOString(), used_by: userId })
        .eq('id', inviteId)
        .eq('status', 'pending')
    if (error) console.error('Failed to mark invite used:', error)
}
