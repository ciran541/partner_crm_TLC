import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client.
 * Reads the session from HTTP cookies — for use in:
 *  - API Route handlers (route.ts)
 *  - Server Components
 *  - Middleware
 * Never use this in 'use client' components.
 */
export async function createServerSupabaseClient() {
    const cookieStore = await cookies()

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    // Persist refreshed-session cookies. In Route Handlers / Server
                    // Actions this writes them; in Server Components `.set` throws,
                    // which is safe to ignore because middleware refreshes sessions.
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options)
                        )
                    } catch {
                        /* called from a Server Component — ignore */
                    }
                },
            },
        }
    )
}
