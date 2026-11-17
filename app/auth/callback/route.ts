import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Only ever redirect within our own site. String-concatenating `${origin}${next}`
 * was an open redirect: next=@evil.com produced https://ourapp.com@evil.com
 * (everything before the @ is read as a username), and //evil.com or /\evil.com
 * are protocol-relative to browsers. Resolving against our origin and then
 * comparing origins catches all of those forms without enumerating them.
 */
function safeNextPath(raw: string | null, origin: string): string {
    if (!raw) return '/'
    try {
        const url = new URL(raw, origin)
        if (url.origin !== origin) return '/'
        return url.pathname + url.search + url.hash
    } catch {
        return '/'
    }
}

export async function GET(request: NextRequest) {
    const { searchParams, origin } = new URL(request.url)
    const code = searchParams.get('code')
    const next = safeNextPath(searchParams.get('next'), origin)

    if (code) {
        const cookieStore = await cookies()
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll() { return cookieStore.getAll() },
                    setAll(cookiesToSet) {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    },
                },
            }
        )

        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return NextResponse.redirect(`${origin}${next}`)
        }
    }

    // Invalid or expired code — send to reset page to show the error state
    return NextResponse.redirect(`${origin}/auth/reset-password?error=invalid`)
}
