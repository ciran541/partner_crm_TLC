import { NextResponse } from 'next/server'
import { getServerUser } from './getUser'
import { canAccessInsurance, isAdmin } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/shared'

type InsuranceGuardResult =
    | { authorized: true; userId: string; role: UserRole; isAdmin: boolean }
    | { authorized: false; response: NextResponse }

/**
 * API route guard: verifies the caller is authenticated and can access the
 * insurance CRM (insurance agents + admins). Mirrors requirePropertyUser().
 */
export async function requireInsuranceUser(): Promise<InsuranceGuardResult> {
    const { user, profile } = await getServerUser()

    if (!user || !profile) {
        return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }

    if (!canAccessInsurance(profile.role, profile.app_type)) {
        return { authorized: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
    }

    return { authorized: true, userId: user.id, role: profile.role, isAdmin: isAdmin(profile.role) }
}
