'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

export default function UserManagementPage() {
    const router = useRouter()

    useEffect(() => {
        const checkAdmin = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser()

            if (!user) {
                router.replace('/login')
                return
            }

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()

            if (profile?.role !== 'admin') {
                router.replace('/dashboard')
            }
        }

        checkAdmin()
    }, [router])

    return <h1>User Management (Admin Only)</h1>
}
