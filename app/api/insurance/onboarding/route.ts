import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getServerUser } from '@/lib/auth/getUser'
import type { OnboardingProgress } from '@/lib/types/shared'

// `onboarding` isn't in the profiles client column-restricted UPDATE grant
// (see CLAUDE.md RLS notes — that grant is intentionally not widened), so
// progress writes go through this service-role route instead, scoped to the
// caller's own row only.
export async function PATCH(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const body = await request.json()
        const current: OnboardingProgress = {
            completed_at: null,
            profile_completed: false,
            tour_completed: false,
            ...profile.onboarding,
        }

        const next: OnboardingProgress = {
            ...current,
            ...('profile_completed' in body ? { profile_completed: !!body.profile_completed } : {}),
            ...('tour_completed' in body ? { tour_completed: !!body.tour_completed } : {}),
            ...('checklist_dismissed' in body ? { checklist_dismissed: !!body.checklist_dismissed } : {}),
        }

        if (body.complete && !next.completed_at) {
            next.completed_at = new Date().toISOString()
        }

        const supabaseAdmin = createAdminClient()
        const { error } = await supabaseAdmin
            .from('profiles')
            .update({ onboarding: next })
            .eq('id', user.id)

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ onboarding: next })
    } catch (error: any) {
        console.error('Onboarding API Error:', error)
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
    }
}
