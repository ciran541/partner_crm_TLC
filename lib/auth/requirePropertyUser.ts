import { NextResponse } from 'next/server'
import { getServerUser } from './getUser'
import { canAccessProperty } from '@/lib/permissions'

type PropertyGuardResult =
    | { authorized: true; userId: string }
    | { authorized: false; response: NextResponse }

/**
 * API route guard: verifies the caller is authenticated and can access
 * the property platform (property agents + admins).
 * Mirrors the pattern of requireAdminUser() in requireAdmin.ts.
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

    return { authorized: true, userId: user.id }
}
