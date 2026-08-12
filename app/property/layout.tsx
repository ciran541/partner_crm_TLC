'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, usePathname } from 'next/navigation'
import { canAccessProperty, getSafeRoute, hasPropertyPremium } from '@/lib/permissions'
import { clearCasesCache } from '@/lib/property/useCases'
import { needsReconsent } from '@/lib/legal/checkConsent'
import { PropertyProfileContext, type PropertyProfileState } from '@/lib/property/propertyProfileContext'
import {
    LayoutDashboard,
    Briefcase,
    DollarSign,
    Bell,
    User,
    LogOut,
    Clock,
    Percent,
    Calculator,
    BarChart2,
    Landmark,
    Lock,
    ChevronDown,
    ChevronRight,
} from 'lucide-react'

// Standard agents keep this exact flat list, unchanged.
const internalNavItems = [
    { name: 'Dashboard', href: '/property/dashboard', icon: LayoutDashboard },
    { name: 'Cases', href: '/property/cases', icon: Briefcase },
    { name: 'Follow Up', href: '/property/followup', icon: Clock },
    { name: 'Earnings', href: '/property/earnings', icon: DollarSign },
    { name: 'Notifications', href: '/property/notifications', icon: Bell },
    { name: 'Profile', href: '/property/profile', icon: User },
]

// Premium-only — shown first, matching the Tools/Internal split already used
// by app/insurance/dashboard/layout.tsx.
const toolsNavItems = [
    { name: 'Rates', href: '/property/rates', icon: Percent },
    { name: 'Calculators', href: '/property/calculators', icon: Calculator },
    { name: 'Resources', href: '/property/resources/news', icon: BarChart2 },
    { name: "Bank Insights", href: '/property/bank-insights', icon: Landmark },
]

export default function PropertyLayout({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [email, setEmail] = useState<string | null>(null)
    const [profileState, setProfileState] = useState<PropertyProfileState>({
        loading: true, role: null, appType: null, tier: null, isPremium: false,
    })
    // Collapsed by default — mirrors the "Internal — back-of-house section"
    // default in app/insurance/dashboard/layout.tsx.
    const [internalOpen, setInternalOpen] = useState(false)

    const isAuthPage = pathname === '/property/login' || pathname === '/property/signup'

    // Instant shell: read the email/initials from the LOCAL session (no network
    // round-trip) so the chrome renders immediately instead of behind a spinner.
    useEffect(() => {
        if (isAuthPage) return
        let active = true
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (active) setEmail(session?.user?.email ?? null)
        })
        return () => { active = false }
    }, [isAuthPage])

    // Authoritative auth check — runs ONCE per property session (no `pathname`
    // dependency, so it doesn't re-fire on every tab switch). Middleware already
    // bounces unauthenticated users, so this never blocks first paint; it only
    // redirects wrong-domain (e.g. insurance) or disabled accounts.
    useEffect(() => {
        let active = true
        const run = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!active) return

            if (isAuthPage) {
                if (user) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('role, app_type')
                        .eq('id', user.id)
                        .single()
                    if (active && profile && canAccessProperty(profile.role, profile.app_type)) {
                        router.replace(getSafeRoute(profile.role, profile.app_type))
                    }
                }
                return
            }

            if (!user) return // middleware handles the redirect to /property/login

            const { data: profile } = await supabase
                .from('profiles')
                .select('role, app_type, status, subscription_tier')
                .eq('id', user.id)
                .single()
            if (!active) return

            if (!profile || !canAccessProperty(profile.role, profile.app_type)) {
                router.replace(profile ? getSafeRoute(profile.role, profile.app_type) : '/property/login')
                return
            }

            if (profile.status === 'disabled') {
                await supabase.auth.signOut()
                router.replace('/property/login?error=account_disabled')
                return
            }

            if (await needsReconsent(supabase, user.id)) {
                router.replace('/consent/renew')
                return
            }

            setProfileState({
                loading: false,
                role: profile.role,
                appType: profile.app_type,
                tier: profile.subscription_tier ?? 'standard',
                isPremium: hasPropertyPremium(profile.role, profile.app_type, profile.subscription_tier),
            })
        }
        run()
        return () => { active = false }
    }, [isAuthPage, router])

    const handleSignOut = async () => {
        clearCasesCache()
        await supabase.auth.signOut()
        router.push('/property/login')
    }

    if (isAuthPage) {
        return <>{children}</>
    }

    const initials = email ? email[0].toUpperCase() : 'P'

    return (
        <PropertyProfileContext.Provider value={profileState}>
        <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
            {/* Desktop Sidebar */}
            <aside
                className="hidden md:flex flex-col fixed inset-y-0 left-0 w-[240px] z-40 sidebar-container"
            >
                {/* Brand */}
                <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <img
                            src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                            alt="TLC Logo"
                            style={{ width: 36, height: 36, borderRadius: 9 }}
                        />
                        <div>
                            <p style={{ fontSize: 12, fontWeight: 700, color: 'white', lineHeight: 1.2 }}>The Loan Connection</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
                                <p style={{ fontSize: 10, fontWeight: 600, color: '#6ee7b7', letterSpacing: '0.03em' }}>Property Portal</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Nav */}
                <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
                    {profileState.isPremium ? (
                        <>
                            {toolsNavItems.map((item) => {
                                const isActive = pathname?.startsWith(item.href)
                                return (
                                    <Link
                                        key={item.name}
                                        href={item.href}
                                        prefetch
                                        className={`sidebar-link${isActive ? ' active' : ''}`}
                                        style={isActive ? {
                                            borderLeftColor: '#34d399',
                                            background: 'linear-gradient(90deg, rgba(52,211,153,0.15) 0%, transparent 100%)',
                                        } : {}}
                                    >
                                        <item.icon size={18} />
                                        {item.name}
                                    </Link>
                                )
                            })}

                            <button
                                type="button"
                                onClick={() => setInternalOpen(o => !o)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    marginTop: 18, marginBottom: 6, padding: '0 16px',
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: 11, fontWeight: 700, color: '#94a3b8',
                                    textTransform: 'uppercase', letterSpacing: '0.08em',
                                }}
                            >
                                <Lock size={11} />
                                <span style={{ flex: 1, textAlign: 'left' }}>Internal</span>
                                {internalOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>

                            {internalOpen && internalNavItems.map((item) => {
                                const isActive = pathname?.startsWith(item.href)
                                return (
                                    <Link
                                        key={item.name}
                                        href={item.href}
                                        prefetch
                                        className={`sidebar-link${isActive ? ' active' : ''}`}
                                        style={isActive ? {
                                            borderLeftColor: '#34d399',
                                            background: 'linear-gradient(90deg, rgba(52,211,153,0.15) 0%, transparent 100%)',
                                        } : {}}
                                    >
                                        <item.icon size={18} />
                                        {item.name}
                                    </Link>
                                )
                            })}
                        </>
                    ) : (
                        internalNavItems.map((item) => {
                            const isActive = pathname?.startsWith(item.href)
                            return (
                                <Link
                                    key={item.name}
                                    href={item.href}
                                    prefetch
                                    className={`sidebar-link${isActive ? ' active' : ''}`}
                                    style={isActive ? {
                                        borderLeftColor: '#34d399',
                                        background: 'linear-gradient(90deg, rgba(52,211,153,0.15) 0%, transparent 100%)',
                                    } : {}}
                                >
                                    <item.icon size={18} />
                                    {item.name}
                                </Link>
                            )
                        })
                    )}
                </nav>

                {/* User Footer */}
                <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: '#059669',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', fontSize: 13, fontWeight: 700, flexShrink: 0,
                        }}>
                            {initials}
                        </div>
                        <p style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {email?.split('@')[0]}
                        </p>
                    </div>
                    <button
                        onClick={handleSignOut}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#94a3b8', fontSize: 12, fontWeight: 500,
                            padding: 0, transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#fca5a5')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#94a3b8')}
                    >
                        <LogOut size={13} />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Mobile status-bar tint — covers the safe-area inset only, no content */}
            <div
                className="md:hidden fixed top-0 left-0 right-0 z-50 ios-topbar ios-blur"
                style={{ background: 'rgba(5,45,74,0.82)' }}
            />

            {/* Mobile Bottom Tab Bar — frosted, safe-area aware. Premium agents get
                all ten items in a horizontally scrollable strip instead of the
                fixed-width flex layout, since that only comfortably fits ~6. */}
            <nav
                className={`md:hidden fixed bottom-0 left-0 right-0 z-40 flex ios-tabbar ios-blur ${profileState.isPremium ? 'overflow-x-auto' : ''}`}
                style={{ background: 'rgba(255,255,255,0.86)', borderTop: '1px solid #e2e8f0' }}
            >
                {(profileState.isPremium ? [...toolsNavItems, ...internalNavItems] : internalNavItems).map((item) => {
                    const isActive = pathname?.startsWith(item.href)
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            prefetch
                            className="pressable"
                            style={{
                                flex: profileState.isPremium ? '0 0 auto' : 1,
                                minWidth: profileState.isPremium ? 68 : undefined,
                                minHeight: 50,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 3,
                                padding: '8px 4px',
                                fontSize: 10,
                                fontWeight: 600,
                                color: isActive ? '#059669' : '#94a3b8',
                                textDecoration: 'none',
                            }}
                        >
                            <item.icon size={23} strokeWidth={isActive ? 2.4 : 2} />
                            <span>{item.name}</span>
                        </Link>
                    )
                })}
            </nav>

            {/* Page Content */}
            <div className="md:pl-[240px]">
                <div
                    className="px-4 pt-[calc(20px+env(safe-area-inset-top))] pb-[calc(64px+env(safe-area-inset-bottom))] md:px-8 md:py-7"
                    style={{ minHeight: '100dvh' }}
                >
                    {children}
                </div>
            </div>
        </div>
        </PropertyProfileContext.Provider>
    )
}
