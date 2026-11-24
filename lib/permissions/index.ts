import type { UserRole, AppType, SubscriptionTier } from '@/lib/types/shared'

/**
 * Permission helpers — centralised role and domain checks.
 * Use these instead of inline role string comparisons throughout the app.
 */

/** Returns true if the role has admin privileges (legacy 'admin' + new 'super_admin') */
export function isAdmin(role: UserRole): boolean {
    return role === 'admin' || role === 'super_admin'
}

/** Returns true for regular agents (insurance or property) */
export function isAgent(role: UserRole): boolean {
    return role === 'agent'
}

/** Returns true if the user belongs to the insurance domain */
export function isInsuranceUser(appType: AppType): boolean {
    return appType === 'insurance'
}

/** Returns true if the user belongs to the property domain */
export function isPropertyUser(appType: AppType): boolean {
    return appType === 'property'
}

/** Returns true if the user can access the admin panel */
export function canAccessAdmin(role: UserRole): boolean {
    return isAdmin(role)
}

/** Returns true if the user can access the insurance app (shown to users as the "Premium" plan) */
export function canAccessInsurance(role: UserRole, appType: AppType): boolean {
    return isAdmin(role) || (isAgent(role) && isInsuranceUser(appType))
}

/** Returns true if the user can access the property app */
export function canAccessProperty(role: UserRole, appType: AppType): boolean {
    return isAdmin(role) || (isAgent(role) && isPropertyUser(appType))
}

/**
 * Returns true if the user can access premium-tier property-app features
 * (shown to users as the "Basic" plan — see planName()).
 * Tier is only meaningful for property agents — admins always pass (support/
 * testing), matching the isAdmin() short-circuit used by every other
 * canAccess* check in this file.
 */
export function hasPropertyPremium(role: UserRole, appType: AppType, tier: SubscriptionTier | null | undefined): boolean {
    return isAdmin(role) || (canAccessProperty(role, appType) && tier === 'premium')
}

/**
 * Customer-facing plan names. TLC HUB is sold by plan, not by profession —
 * freelance brokers use the "insurance" app without being insurance agents —
 * so the UI never says "Insurance Agent" / "Property Agent". The stored values
 * (`app_type`, `subscription_tier`) are unchanged; this is a display mapping only:
 *   insurance                  → Premium
 *   property + tier 'premium'  → Basic
 *   property + tier 'standard' → Starter
 */
export type PlanName = 'Premium' | 'Basic' | 'Starter'

export const PLAN_NAMES = {
    insurance: 'Premium',
    propertyPremium: 'Basic',
    propertyStandard: 'Starter',
} as const satisfies Record<string, PlanName>

export function planName(appType: AppType | null | undefined, tier?: SubscriptionTier | null): PlanName {
    if (appType === 'insurance') return PLAN_NAMES.insurance
    return tier === 'premium' ? PLAN_NAMES.propertyPremium : PLAN_NAMES.propertyStandard
}

/** Plan name for an agent, or the admin title for admins. */
export function accountLabel(role: UserRole | null | undefined, appType: AppType | null | undefined, tier?: SubscriptionTier | null): string {
    // One admin role; 'admin' and 'super_admin' are the same thing stored two ways.
    if (role === 'admin' || role === 'super_admin') return 'Admin'
    return planName(appType, tier)
}

/** Returns the correct safe fallback route based on the user's role and domain */
export function getSafeRoute(role: UserRole, appType: AppType): string {
    if (isAdmin(role)) return '/admin'
    if (isPropertyUser(appType)) return '/property/dashboard'
    return '/insurance/dashboard'
}
