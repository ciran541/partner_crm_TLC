import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Edge auth gate + session refresh for the property app.
 *
 * Runs only on /property/* page navigations (the matcher excludes /api, static
 * assets and _next). It refreshes the Supabase session cookie and bounces
 * unauthenticated visitors to the login page — so the client layout can render
 * the shell instantly without blocking on a network auth check, and logged-out
 * users never see the app chrome flash. Role/domain authorization stays in the
 * API routes and the layout, which remain authoritative.
 */
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

    // Refreshes the auth token if needed and tells us whether a session exists.
    const { data: { user } } = await supabase.auth.getUser()

    const { pathname } = request.nextUrl
    const isAuthPage = pathname === '/property/login' || pathname === '/property/signup'

    if (!user && !isAuthPage) {
        const url = request.nextUrl.clone()
        url.pathname = '/property/login'
        url.search = ''
        return NextResponse.redirect(url)
    }

    return response
}

export const config = {
    // Only property page routes — API routes do their own auth, and assets are skipped.
    matcher: ['/property/:path*'],
}
