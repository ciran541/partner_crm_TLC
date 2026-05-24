import { NextResponse } from 'next/server'
import { getServerUser } from './getUser'

type AdminGuardResult =
    | { authorized: true; userId: string }
    | { authorized: false; response: NextResponse }

/**
 * API route guard: verifies the caller is authenticated AND has admin privileges.
 * Accepts both 'admin' (legacy) and 'super_admin' (new) roles.
 *
 * Usage in API routes:
 *   const auth = await requireAdminUser()
 *   if (!auth.authorized) return auth.response
 */
export async function requireAdminUser(): Promise<AdminGuardResult> {
    const { user, profile } = await getServerUser()

    if (!user) {
        return {
            authorized: false,
            response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        }
    }

    // Accept 'admin' (legacy DB value) and 'super_admin' (new standard)
    const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin'

    if (!isAdmin) {
        return {
            authorized: false,
            response: NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 }),
        }
    }

    return { authorized: true, userId: user.id }
}
