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

/** Returns true if the user can access the insurance CRM */
export function canAccessInsurance(role: UserRole, appType: AppType): boolean {
    return isAdmin(role) || (isAgent(role) && isInsuranceUser(appType))
}

/** Returns true if the user can access the property app */
export function canAccessProperty(role: UserRole, appType: AppType): boolean {
    return isAdmin(role) || (isAgent(role) && isPropertyUser(appType))
}

/**
 * Returns true if the user can access premium-tier Property CRM features.
 * Tier is only meaningful for property agents — admins always pass (support/
 * testing), matching the isAdmin() short-circuit used by every other
 * canAccess* check in this file.
 */
export function hasPropertyPremium(role: UserRole, appType: AppType, tier: SubscriptionTier | null | undefined): boolean {
    return isAdmin(role) || (canAccessProperty(role, appType) && tier === 'premium')
}

/** Returns the correct safe fallback route based on the user's role and domain */
export function getSafeRoute(role: UserRole, appType: AppType): string {
    if (isAdmin(role)) return '/admin'
    if (isPropertyUser(appType)) return '/property/dashboard'
    return '/insurance/dashboard'
}
