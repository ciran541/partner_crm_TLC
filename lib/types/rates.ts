// Layer 5 (foundation): in-app mortgage rate packages.
// Rates are stored structured so they are filterable/sortable now and
// computable by the workflow engine in phase 2.

import type { FloatingRateType } from './workflow'

export const PROPERTY_TYPES = ['HDB', 'Private', 'HDB / Private', 'Executive Condominium'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export const RATE_CATEGORIES = ['Fixed', 'Floating (Completed)', 'BUC'] as const
export type RateCategory = (typeof RATE_CATEGORIES)[number]

// Lock-in stored as an integer count of years; 0 = No Lock-in.
export const LOCKIN_OPTIONS = [0, 1, 2, 3, 4, 5] as const

// Standard floating references (aligns with the workflow's FloatingRateType),
// but `reference` is a free string so legacy values like "1M Compounded SORA"
// or "FD Rate" survive a migration without data loss.
export const RATE_REFERENCES: readonly string[] = ['3M SORA', '1M SORA', 'FD Rate']

/** One row of a package's rate schedule. Ordered array; index 0 = first period. */
export interface RateScheduleEntry {
    year?: number | null          // 1, 2, 3… ; omit/null when `thereafter` is true
    thereafter?: boolean          // the "Thereafter" trailing rate
    type: 'fixed' | 'floating'
    rate?: number                 // fixed rate %, e.g. 2.00
    reference?: string            // floating benchmark, e.g. "3M SORA"
    spread?: number               // floating margin %, e.g. 0.35
}

export interface MortgagePackage {
    id: string
    bank: string
    property_type: string
    category: RateCategory
    min_loan_size: number
    package_name: string
    lockin_years: number
    rate_schedule: RateScheduleEntry[]
    first_year_rate: number | null
    features: string[]
    subsidies: string | null
    remarks: string | null
    status: 'published' | 'draft'
    last_updated: string          // YYYY-MM-DD
    created_at?: string
    updated_at?: string
}

export interface MortgagePackageInput {
    bank: string
    property_type: string
    category: RateCategory
    min_loan_size: number
    package_name: string
    lockin_years: number
    rate_schedule: RateScheduleEntry[]
    features: string[]
    subsidies?: string | null
    remarks?: string | null
    status?: 'published' | 'draft'
}

// Map a free-text reference down to the workflow's constrained set (phase 2).
export function normalizeReference(ref?: string): FloatingRateType | null {
    if (!ref) return null
    const r = ref.toLowerCase()
    if (r.includes('1m')) return '1M SORA'
    if (r.includes('3m')) return '3M SORA'
    if (r.includes('fd')) return 'FD Rate'
    return null
}
