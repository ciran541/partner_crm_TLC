import { NextResponse } from 'next/server'
import { getServerUser } from './getUser'
import { canAccessProperty, isAdmin } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/shared'

type PropertyGuardResult =
    | { authorized: true; userId: string; role: UserRole; isAdmin: boolean }
    | { authorized: false; response: NextResponse }

/**
 * API route guard: verifies the caller is authenticated and can access
 * the property platform (property agents + admins).
 * Mirrors the pattern of requireAdminUser() in requireAdmin.ts.
 *
 * Returns the caller's role/isAdmin (already fetched during auth) so routes
 * don't have to re-query the profiles table just to check privileges.
 */
export async function requirePropertyUser(): Promise<PropertyGuardResult> {
    const { user, profile } = await getServerUser()

    if (!user || !profile) {
        return {
            authorized: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        }
    }

    if (!canAccessProperty(profile.role, profile.app_type)) {
        return {
            authorized: false,
            response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
        }
    }

    return {
        authorized: true,
        userId: user.id,
        role: profile.role,
        isAdmin: isAdmin(profile.role),
    }
}
