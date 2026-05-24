'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getSafeRoute } from '@/lib/permissions'

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
                .select('role, app_type')
                .eq('id', user.id)
                .single()

            if (!profile) {
                router.replace('/insurance/dashboard')
                return
            }

            router.replace(getSafeRoute(profile.role, profile.app_type))
        }

        redirectUser()
    }, [router])

    return <p>Redirecting...</p>
}