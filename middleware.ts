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

    const { data: { user } } = await supabase.auth.getUser()

    const { pathname } = request.nextUrl

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
    }

    return response
}

export const config = {
    matcher: ['/property/:path*', '/insurance/:path*'],
}
