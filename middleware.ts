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
 * Also enforces:
 * - Account activation: disabled/pending accounts are bounced with ?reason=suspended
 * - Single concurrent session: a new login from another device invalidates the previous
 *   session cookie and bounces the old session with ?reason=kicked
 */

type ProfileGuard = { status: string; current_session_id: string | null }

async function fetchProfileGuard(userId: string): Promise<ProfileGuard | null> {
    try {
        const res = await fetch(
            `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=status,current_session_id&limit=1`,
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

    const { pathname } = request.nextUrl
    const loginPath = pathname.startsWith('/property/') ? '/property/login' : '/insurance/login'

    if (!user) {
        const isPropertyAuthPage = pathname === '/property/login' || pathname === '/property/signup'
        const isInsuranceAuthPage = pathname === '/insurance/login' || pathname === '/insurance/forgot-password'

        if (pathname.startsWith('/property/') && !isPropertyAuthPage) {
            const url = request.nextUrl.clone()
            url.pathname = '/property/login'
            url.search = ''
            return NextResponse.redirect(url)
        }

        if (pathname.startsWith('/insurance/') && !isInsuranceAuthPage) {
            const url = request.nextUrl.clone()
            url.pathname = '/insurance/login'
            url.search = ''
            return NextResponse.redirect(url)
        }
    } else {
        const profile = await fetchProfileGuard(user.id)

        if (profile?.status === 'disabled') {
            const url = request.nextUrl.clone()
            url.pathname = loginPath
            url.search = '?reason=suspended'
            return NextResponse.redirect(url)
        }

        const sessionGuard = request.cookies.get('session_guard')?.value
        if (
            profile?.current_session_id &&
            sessionGuard &&
            sessionGuard !== profile.current_session_id
        ) {
            const url = request.nextUrl.clone()
            url.pathname = loginPath
            url.search = '?reason=kicked'
            return NextResponse.redirect(url)
        }
    }

    return response
}

export const config = {
    matcher: ['/property/:path*', '/insurance/:path*'],
}
