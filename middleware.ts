import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Edge auth gate + session refresh for the property and insurance apps.
 *
 * Runs on /property/* and /insurance/* page navigations (the matcher excludes
 * /api, static assets and _next). It refreshes the Supabase session cookie and
 * bounces unauthenticated visitors to their respective login page — so the
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

type ProfileGuard = { status: string }

async function fetchProfileGuard(userId: string): Promise<ProfileGuard | null> {
    try {
        const res = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=status&limit=1`,
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
    const loginPath = pathname.startsWith('/property/') ? '/property/login' : '/insurance/login'
    const isPropertyAuthPage = pathname === '/property/login' || pathname === '/property/signup'
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
    }

    return response
}

export const config = {
    matcher: ['/property/:path*', '/insurance/:path*'],
}
