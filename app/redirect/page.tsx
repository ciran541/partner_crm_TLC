'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getSafeRoute } from '@/lib/permissions'
import { saveLinkedAccount } from '@/lib/auth/accountSwitcher'

export default function RedirectPage() {
    const router = useRouter()

    useEffect(() => {
        const redirectUser = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser()

            if (!user) {
                router.replace('/login')
                return
            }

            // Fetch profile to determine routing
            const { data: profile } = await supabase
                .from('profiles')
                .select('role, app_type, name')
                .eq('id', user.id)
                .single()

            if (!profile) {
                router.replace('/insurance/dashboard')
                return
            }

            const { data: { session } } = await supabase.auth.getSession()
            if (session) {
                saveLinkedAccount({
                    userId: user.id,
                    email: user.email ?? '',
                    name: profile.name ?? null,
                    role: profile.role,
                    appType: profile.app_type,
                    accessToken: session.access_token,
                    refreshToken: session.refresh_token,
                })
            }

            router.replace(getSafeRoute(profile.role, profile.app_type))
        }

        redirectUser()
    }, [router])

    return <p>Redirecting...</p>
}