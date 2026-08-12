'use client'

import { createContext, useContext } from 'react'
import type { UserRole, AppType, SubscriptionTier } from '@/lib/types/shared'

// Populated by app/property/layout.tsx's existing per-navigation profile
// fetch — avoids every premium page re-querying Supabase for the same data.
export interface PropertyProfileState {
    loading: boolean
    role: UserRole | null
    appType: AppType | null
    tier: SubscriptionTier | null
    isPremium: boolean
}

export const PropertyProfileContext = createContext<PropertyProfileState>({
    loading: true,
    role: null,
    appType: null,
    tier: null,
    isPremium: false,
})

export function usePropertyProfile() {
    return useContext(PropertyProfileContext)
}
