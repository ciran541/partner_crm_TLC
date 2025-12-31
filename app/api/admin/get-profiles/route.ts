import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { Profile } from '@/lib/types'

// Prevent caching
export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )

        // 1. Get all Profiles
        const { data: profiles, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false })

        if (profileError) {
            return NextResponse.json({ error: profileError.message }, { status: 500 })
        }

        // 2. Get all Auth Users
        const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers()

        if (authError) {
            return NextResponse.json({ error: authError.message }, { status: 500 })
        }

        // 3. Merge Data
        // Map email from Auth to Profile
        const mergedProfiles: Profile[] = profiles.map((p: any) => {
            const authUser = users.find(u => u.id === p.id)
            return {
                id: p.id,
                name: p.name,
                role: p.role,
                created_at: p.created_at,
                email: authUser?.email || 'Unknown'
            }
        })

        return NextResponse.json(mergedProfiles)

    } catch (error: any) {
        console.error('Get Profiles Error:', error)
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
    }
}
