'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, usePathname } from 'next/navigation'
import { canAccessInsurance, getSafeRoute } from '@/lib/permissions'
import { clearCasesCache } from '@/lib/insurance/useCases'
import {
    LayoutDashboard,
    Briefcase,
    Users,
    LogOut,
    TrendingUp,
    Percent,
    UserCircle,
    BookOpen,
} from 'lucide-react'

const coreNav = [
    { name: 'Dashboard', href: '/insurance/dashboard', icon: LayoutDashboard },
    { name: 'Cases', href: '/insurance/dashboard/cases', icon: Briefcase },
    { name: 'Knowledge', href: '/insurance/dashboard/knowledge', icon: BookOpen },
    { name: 'Rates', href: '/insurance/dashboard/rates', icon: Percent },
]

const adminNav = [
    { name: 'User Management', href: '/insurance/dashboard/users', icon: Users },
    { name: 'Analytics', href: '/insurance/dashboard/analytics', icon: TrendingUp },
]

const profileNav = { name: 'Profile', href: '/insurance/dashboard/profile', icon: UserCircle }

// The mobile bottom tab bar shows the 5 core agent destinations.
const tabBarItems = [...coreNav, profileNav]

function isActiveHref(pathname: string | null, href: string) {
    return pathname === href || (href !== '/insurance/dashboard' && !!pathname?.startsWith(href))
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [role, setRole] = useState<string | null>(null)
    const [email, setEmail] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState<string | null>(null)

    const isRates = pathname === '/insurance/dashboard/rates'

    // Instant shell: read the email from the LOCAL session (no network round-trip)
    // so the chrome renders immediately instead of behind a full-screen spinner.
    useEffect(() => {
        let active = true
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (active) setEmail(session?.user?.email ?? null)
        })
        return () => { active = false }
    }, [])

    // Authoritative auth check — runs ONCE per session. Middleware already bounces
    // unauthenticated users, so this never blocks first paint; it only redirects
    // wrong-app (e.g. property) or disabled accounts and hydrates name/role.
    useEffect(() => {
        let active = true
        const run = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!active) return

            if (!user) {
                router.replace('/insurance/login')
                return
            }

            const { data: profile } = await supabase
                .from('profiles')
                .select('role, app_type, name, status')
                .eq('id', user.id)
                .single()
            if (!active) return

            if (!profile || !canAccessInsurance(profile.role, profile.app_type)) {
                router.replace(profile ? getSafeRoute(profile.role, profile.app_type) : '/insurance/login')
                return
            }
            if (profile.status === 'disabled') {
                await supabase.auth.signOut()
                router.replace('/insurance/login?error=account_disabled')
                return
            }

            setRole(profile.role ?? 'agent')
            setDisplayName(profile.name ?? null)
            setEmail(user.email ?? null)
        }
        run()
        return () => { active = false }
    }, [router])

    const handleSignOut = async () => {
        clearCasesCache()
        await supabase.auth.signOut()
        router.push('/insurance/login')
    }

    const initials = (displayName || email || 'U')[0].toUpperCase()

    return (
        <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
            {/* Desktop Sidebar */}
            <aside className="hidden md:flex flex-col fixed inset-y-0 left-0 w-[260px] z-40 sidebar-container">
                {/* Brand */}
                <div className="p-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <img
                            src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                            alt="The Loan Connection Logo"
                            className="w-10 h-10 rounded"
                        />
                        <div>
                            <p className="text-base font-bold text-white leading-tight">The Loan Connection</p>
                            <div className="flex items-center gap-1.5 mt-1">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#03a9e7]" />
                                <p className="text-[10px] font-semibold text-[#7dd3fc] tracking-wider">Insurance Portal</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-6 overflow-y-auto">
                    <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                        Main Menu
                    </p>
                    <ul className="space-y-1">
                        {coreNav.map((item) => (
                            <li key={item.name}>
                                <Link
                                    href={item.href}
                                    prefetch
                                    className={`sidebar-link ${isActiveHref(pathname, item.href) ? 'active' : ''}`}
                                >
                                    <item.icon size={20} />
                                    <span>{item.name}</span>
                                </Link>
                            </li>
                        ))}
                        {role === 'admin' && adminNav.map((item) => (
                            <li key={item.name}>
                                <Link
                                    href={item.href}
                                    prefetch
                                    className={`sidebar-link ${isActiveHref(pathname, item.href) ? 'active' : ''}`}
                                >
                                    <item.icon size={20} />
                                    <span>{item.name}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>

                    <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4 mt-6">
                        Account
                    </p>
                    <ul className="space-y-1">
                        <li>
                            <Link
                                href={profileNav.href}
                                prefetch
                                className={`sidebar-link ${isActiveHref(pathname, profileNav.href) ? 'active' : ''}`}
                            >
                                <profileNav.icon size={20} />
                                <span>{profileNav.name}</span>
                            </Link>
                        </li>
                    </ul>
                </nav>

                {/* User Footer */}
                <div className="p-5 border-t border-white/10 bg-black/10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full bg-[#03a9e7] flex items-center justify-center text-white text-sm font-bold shrink-0">
                            {initials}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                                {displayName || email?.split('@')[0] || ' '}
                            </p>
                            <p className="text-[11px] text-slate-400">
                                {role === 'admin' ? 'Administrator' : 'Partner Agent'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 text-[#ee3238] hover:text-[#ff4d4d] transition-colors text-xs font-medium"
                    >
                        <LogOut size={16} />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Mobile Top Bar — brand + sign out */}
            <div
                className="md:hidden fixed top-0 left-0 right-0 z-50 ios-topbar ios-blur"
                style={{ background: 'rgba(5,45,74,0.92)' }}
            >
                <div className="flex items-center justify-between h-14 px-4">
                    <div className="flex items-center gap-2 min-w-0">
                        <img
                            src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                            alt="Logo"
                            className="w-8 h-8 rounded shrink-0"
                        />
                        <span className="text-white font-bold text-sm truncate">The Loan Connection</span>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="text-white/70 hover:text-white transition-colors p-2 shrink-0"
                        aria-label="Sign out"
                    >
                        <LogOut size={18} />
                    </button>
                </div>
            </div>

            {/* Mobile Bottom Tab Bar — frosted, safe-area aware */}
            <nav
                className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex ios-tabbar ios-blur"
                style={{ background: 'rgba(255,255,255,0.86)', borderTop: '1px solid #e2e8f0' }}
            >
                {tabBarItems.map((item) => {
                    const active = isActiveHref(pathname, item.href)
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            prefetch
                            className="pressable"
                            style={{
                                flex: 1,
                                minHeight: 50,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 3,
                                padding: '8px 4px',
                                fontSize: 10,
                                fontWeight: 600,
                                color: active ? '#03a9e7' : '#94a3b8',
                                textDecoration: 'none',
                            }}
                        >
                            <item.icon size={22} strokeWidth={active ? 2.4 : 2} />
                            <span>{item.name}</span>
                        </Link>
                    )
                })}
            </nav>

            {/* Page Content */}
            <div className="md:pl-[260px]">
                {isRates ? (
                    <div className="h-[100dvh] overflow-hidden p-0">
                        <div className="h-full flex flex-col pt-[calc(56px+env(safe-area-inset-top))] md:pt-0">
                            {children}
                        </div>
                    </div>
                ) : (
                    <div
                        className="px-4 pt-[calc(64px+env(safe-area-inset-top))] pb-[calc(72px+env(safe-area-inset-bottom))] md:px-8 md:py-7"
                        style={{ minHeight: '100dvh' }}
                    >
                        <div className="max-w-[1200px] mx-auto">{children}</div>
                    </div>
                )}
            </div>
        </div>
    )
}
