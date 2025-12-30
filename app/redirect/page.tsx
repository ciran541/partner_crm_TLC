'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

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

            // No role-based redirect anymore
            // Everyone goes to dashboard
            router.replace('/dashboard')
        }

        redirectUser()
    }, [router])

    return <p>Redirecting...</p>
}