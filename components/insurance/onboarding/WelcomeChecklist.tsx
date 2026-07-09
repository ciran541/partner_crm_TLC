'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import type { OnboardingProgress } from '@/lib/types/shared'
import { CheckCircle2, Circle, X, Sparkles } from 'lucide-react'

export default function WelcomeChecklist() {
    const [onboarding, setOnboarding] = useState<OnboardingProgress | null>(null)
    const [dismissing, setDismissing] = useState(false)

    useEffect(() => {
        let active = true
        supabase.auth.getUser().then(async ({ data: { user } }) => {
            if (!user) return
            const { data: profile } = await supabase
                .from('profiles')
                .select('onboarding')
                .eq('id', user.id)
                .single()
            if (active) setOnboarding(profile?.onboarding ?? null)
        })
        return () => { active = false }
    }, [])

    if (!onboarding?.completed_at) return null
    if (onboarding.checklist_dismissed) return null
    if (onboarding.profile_completed && onboarding.tour_completed) return null

    const items = [
        { label: 'Complete your profile', done: !!onboarding.profile_completed, href: '/insurance/onboarding?step=profile' },
        { label: 'Take the product tour', done: !!onboarding.tour_completed, href: '/insurance/onboarding?step=tour' },
    ]

    const dismiss = async () => {
        setDismissing(true)
        setOnboarding(o => o ? { ...o, checklist_dismissed: true } : o)
        await fetch('/api/insurance/onboarding', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checklist_dismissed: true }),
        }).catch(() => {})
        setDismissing(false)
    }

    return (
        <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4 border-sky-100 bg-sky-50/40">
            <div className="flex items-center gap-2 shrink-0">
                <Sparkles size={18} className="text-[#03a9e7]" />
                <span className="text-sm font-bold text-[#052d4a]">Finish setting up</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 flex-1">
                {items.map(item => (
                    <Link
                        key={item.label}
                        href={item.href}
                        className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-[#03a9e7] transition-colors"
                    >
                        {item.done
                            ? <CheckCircle2 size={16} className="text-emerald-500" />
                            : <Circle size={16} className="text-slate-300" />
                        }
                        <span className={item.done ? 'line-through text-slate-400' : ''}>{item.label}</span>
                    </Link>
                ))}
            </div>
            <button
                onClick={dismiss}
                disabled={dismissing}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors shrink-0"
                title="Dismiss"
            >
                <X size={16} />
            </button>
        </div>
    )
}
