import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { Profile } from '@/lib/types/shared'

// Prevent caching
export const dynamic = 'force-dynamic'

export async function GET() {
    // 🔒 Server-side admin guard — verifies caller is authenticated admin
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    try {
        const supabaseAdmin = createAdminClient()

        // 1. Get all Profiles
        const { data: profiles, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false })

        if (profileError) {
            return NextResponse.json({ error: profileError.message }, { status: 500 })
        }

        // 2. Get all Auth Users
        const {
            data: { users },
            error: authError,
        } = await supabaseAdmin.auth.admin.listUsers()

        if (authError) {
            return NextResponse.json({ error: authError.message }, { status: 500 })
        }

        // 3. Merge Data — map email from Auth to Profile
        const mergedProfiles: Profile[] = profiles.map((p: any) => {
            const authUser = users.find((u) => u.id === p.id)
            return {
                id: p.id,
                name: p.name,
                role: p.role,
                app_type: p.app_type ?? 'insurance',
                status: p.status ?? 'active',
                subscription_tier: p.subscription_tier ?? 'standard',
                created_at: p.created_at,
                email: authUser?.email || 'Unknown',
            }
        })

        return NextResponse.json(mergedProfiles)
    } catch (error: any) {
        console.error('Get Profiles Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
