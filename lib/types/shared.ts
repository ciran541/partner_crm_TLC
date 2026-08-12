/**
 * Shared types — used across insurance, property, and admin domains.
 * Domain-specific types live in insurance.ts and property.ts.
 */

// Role: 'admin' kept for backward compat with existing DB rows
// Going forward use 'super_admin' for new admin accounts
export type UserRole = 'agent' | 'super_admin' | 'admin'

// Which product domain the user belongs to
export type AppType = 'insurance' | 'property'

// Account status
export type UserStatus = 'active' | 'disabled'

// Paid feature tier — currently only meaningful for property agents
// (Property CRM "premium" onboarding tier). Ignored for insurance users.
export type SubscriptionTier = 'standard' | 'premium'

// Profile — matches the profiles table (extended with app_type + status)
export interface Profile {
    id: string
    name: string
    role: UserRole
    app_type: AppType
    status: UserStatus
    created_at: string
    email?: string  // Derived from auth.users, not stored in profiles

    // Property-agent fields (nullable for insurance users)
    full_name?: string
    mobile?: string
    cea_registration_no?: string
    agency_name?: string
    joined_at?: string
    subscription_tier?: SubscriptionTier

    // First-login onboarding progress (insurance agents)
    onboarding?: OnboardingProgress
}

export interface OnboardingProgress {
    completed_at: string | null
    profile_completed: boolean
    tour_completed: boolean
    checklist_dismissed?: boolean
}

// Invite-gated insurance signup — admin generates a link after payment is
// confirmed offline; the agent fills in their own details via that link.
export type InviteStatus = 'pending' | 'used' | 'revoked'

export interface AgentInvite {
    id: string
    token: string
    app_type: AppType
    role: UserRole
    invited_name: string | null
    invited_email: string | null
    status: InviteStatus
    created_by: string | null
    created_at: string
    expires_at: string
    used_at: string | null
    used_by: string | null
}

// User management inputs
export interface CreateUserInput {
    email: string
    name: string
    role: UserRole
    app_type?: AppType    // defaults to 'insurance' for admin-created users
    password?: string
}

export interface UpdateUserInput {
    id: string
    name?: string
    role?: UserRole
    status?: UserStatus
    subscription_tier?: SubscriptionTier
}

// Consent record — matches user_consents table
export interface UserConsent {
    id: string
    user_id: string
    terms_accepted: boolean
    privacy_accepted: boolean
    terms_version: string
    privacy_version: string
    accepted_at: string
    created_at: string
}
