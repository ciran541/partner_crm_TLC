import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessAdmin, getSafeRoute } from '@/lib/permissions'
import type { AppType, UserRole } from '@/lib/types/shared'

/**
 * Edge auth gate + session refresh for the property and insurance apps and
 * the /admin console.
 *
 * Runs on /property/*, /insurance/* and /admin/* page navigations (the matcher
 * excludes /api, static assets and _next). It refreshes the Supabase session
 * cookie and bounces unauthenticated visitors to their respective login page
 * (/login for /admin), and logged-in non-admins away from /admin — so the
 * client layout can render the shell instantly without blocking on a network
 * auth check. Role/domain authorization stays in the API routes and layouts.
 *
 * Also enforces account activation: disabled/pending accounts are bounced with
 * ?reason=suspended.
 *
 * Single concurrent session is enforced separately, at the Supabase Auth level:
 * /api/auth/register-session calls admin.signOut(token, 'others') on every login,
 * which revokes the previous device's refresh token server-side. That device's
 * next supabase.auth.getUser() call below authoritatively fails, so it falls
 * straight into the plain "no user" branch — no local session bookkeeping needed.
 */

type ProfileGuard = { status: string; role: UserRole; app_type: AppType }

async function fetchProfileGuard(userId: string): Promise<ProfileGuard | null> {
    try {
        const res = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=status,role,app_type&limit=1`,
            {
                headers: {
                    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
                    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
                    Accept: 'application/json',
                },
            }
        )
        if (!res.ok) return null
        const rows: ProfileGuard[] = await res.json()
        return rows[0] ?? null
    } catch {
        return null
    }
}

export async function middleware(request: NextRequest) {
    let response = NextResponse.next({ request })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    response = NextResponse.next({ request })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()

    // Redirects must carry over any cookies `setAll` wrote onto `response` above —
    // otherwise a session refreshed (and rotated) on this same request never reaches
    // the browser, leaving it stuck with a dead refresh token until cookies are cleared.
    const redirectTo = (url: URL) => {
        const redirectResponse = NextResponse.redirect(url)
        response.cookies.getAll().forEach(cookie => redirectResponse.cookies.set(cookie))
        return redirectResponse
    }

    const { pathname } = request.nextUrl
    const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/')
    // /login is the admin entry point (it routes via /redirect → getSafeRoute,
    // which lands admins on /admin) — same place app/admin/layout.tsx sends them.
    const loginPath = isAdminPath
        ? '/login'
        : pathname.startsWith('/property/') ? '/property/login' : '/insurance/login'
    const isPropertyAuthPage = pathname === '/property/login' || pathname === '/property/signup' || pathname === '/property/forgot-password'
    const isInsuranceAuthPage = pathname === '/insurance/login' || pathname === '/insurance/forgot-password' || pathname === '/insurance/signup'
    const isAuthPage = isPropertyAuthPage || isInsuranceAuthPage

    if (!user) {
        if (pathname.startsWith('/property/') && !isPropertyAuthPage) {
            const url = request.nextUrl.clone()
            url.pathname = '/property/login'
            url.search = ''
            return redirectTo(url)
        }

        if (pathname.startsWith('/insurance/') && !isInsuranceAuthPage) {
            const url = request.nextUrl.clone()
            url.pathname = '/insurance/login'
            url.search = ''
            return redirectTo(url)
        }

        if (isAdminPath) {
            const url = request.nextUrl.clone()
            url.pathname = '/login'
            url.search = ''
            return redirectTo(url)
        }
    } else if (!isAuthPage) {
        // Skip this check on the login page itself — a disabled user still holds a
        // valid Supabase session there, and redirecting to the same page would loop.
        const profile = await fetchProfileGuard(user.id)

        if (profile?.status === 'disabled') {
            const url = request.nextUrl.clone()
            url.pathname = loginPath
            url.search = '?reason=suspended'
            return redirectTo(url)
        }

        // Logged-in non-admins never get the admin console's HTML at all —
        // bounced to their own home before any admin page renders. If the
        // profile lookup itself failed (profile null), fall through: the admin
        // layout re-checks client-side and every /api/admin/* route enforces
        // requireAdminUser(), so data access never depends on this redirect.
        if (isAdminPath && profile && !canAccessAdmin(profile.role)) {
            const url = request.nextUrl.clone()
            url.pathname = getSafeRoute(profile.role, profile.app_type)
            url.search = ''
            return redirectTo(url)
        }
    }

    return response
}

export const config = {
    matcher: ['/property/:path*', '/insurance/:path*', '/admin/:path*'],
}
