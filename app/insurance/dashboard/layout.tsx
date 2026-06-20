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
    Clock,
    LayoutGrid,
    Calculator,
    Receipt,
    Scale,
    LifeBuoy,
    ChevronDown,
    ChevronRight,
    Lock,
    X,
    BarChart2,
} from 'lucide-react'

type NavItem = { name: string; href: string; icon: React.ElementType; soon?: boolean }

// ── Front-of-house ("Tools") — client-safe. These are the screens an agent uses
//    WHILE sitting with a client. Nothing here reveals other clients or the
//    agent's own sales pipeline, so the app is safe to leave open on a tablet.
const toolsNav: NavItem[] = [
    { name: 'Mortgage Planner', href: '/insurance/dashboard', icon: LayoutGrid },
    { name: 'Calculators', href: '/insurance/dashboard/calculators', icon: Calculator },
    { name: 'Knowledge', href: '/insurance/dashboard/knowledge', icon: BookOpen },
    { name: 'Rates', href: '/insurance/dashboard/rates', icon: Percent },
    { name: 'Resources', href: '/insurance/dashboard/resources', icon: BarChart2 },
    { name: 'Valuation Fees', href: '/insurance/dashboard/valuation', icon: Receipt, soon: true },
    { name: 'Legal', href: '/insurance/dashboard/legal', icon: Scale, soon: true },
]

// ── Back-of-house ("Internal") — cross-client / sales data. Tucked behind a
//    collapsed dropdown and a "More" sheet on mobile so a client glancing at the
//    screen never sees the pipeline, other clients' names, or follow-ups.
const internalNav: NavItem[] = [
    { name: 'Dashboard', href: '/insurance/dashboard/pipeline', icon: LayoutDashboard },
    { name: 'Cases', href: '/insurance/dashboard/cases', icon: Briefcase },
    { name: 'Follow ups', href: '/insurance/dashboard/followup', icon: Clock },
    { name: 'Support', href: '/insurance/dashboard/support', icon: LifeBuoy, soon: true },
    { name: 'Profile', href: '/insurance/dashboard/profile', icon: UserCircle },
]

const adminNav: NavItem[] = [
    { name: 'User Management', href: '/insurance/dashboard/users', icon: Users },
    { name: 'Analytics', href: '/insurance/dashboard/analytics', icon: TrendingUp },
]

// Mobile bottom tab bar shows the 4 primary client-safe tools; everything
// internal lives behind the "More" tab.
const mobileTabs = toolsNav.filter(t => !t.soon).slice(0, 4)

function isActiveHref(pathname: string | null, href: string) {
    return pathname === href || (href !== '/insurance/dashboard' && !!pathname?.startsWith(href))
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [role, setRole] = useState<string | null>(null)
    const [email, setEmail] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState<string | null>(null)

    const isAdmin = role === 'admin' || role === 'super_admin'
    const internalItems = isAdmin ? [...internalNav, ...adminNav] : internalNav
    const internalActive = internalItems.some(i => isActiveHref(pathname, i.href))

    // Internal is collapsed by default (back-of-house); it also stays expanded
    // whenever the current route already lives inside it, so deep links never look
    // broken. Derived (not an effect) to avoid cascading re-renders.
    const [internalOpen, setInternalOpen] = useState(false)
    const internalExpanded = internalOpen || internalActive
    const [moreOpen, setMoreOpen] = useState(false)

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

    const renderToolLink = (item: NavItem) => (
        <li key={item.name}>
            <Link
                href={item.href}
                prefetch
                className={`sidebar-link ${isActiveHref(pathname, item.href) ? 'active' : ''}`}
            >
                <item.icon size={20} />
                <span className="flex-1">{item.name}</span>
                {item.soon && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-white/5 px-1.5 py-0.5 rounded">
                        Soon
                    </span>
                )}
            </Link>
        </li>
    )

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
                                <p className="text-[10px] font-semibold text-[#7dd3fc] tracking-wider">Mortgage Portal</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-6 overflow-y-auto">
                    <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                        Tools
                    </p>
                    <ul className="space-y-1">
                        {toolsNav.map(renderToolLink)}
                    </ul>

                    {/* Internal — collapsed back-of-house section */}
                    <button
                        type="button"
                        onClick={() => setInternalOpen(o => !o)}
                        className="w-full mt-6 mb-2 px-3 flex items-center gap-2 text-[11px] font-semibold text-slate-400 uppercase tracking-widest hover:text-slate-200 transition-colors"
                    >
                        <Lock size={11} />
                        <span className="flex-1 text-left">Internal</span>
                        {internalExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    {internalExpanded && (
                        <ul className="space-y-1">
                            {internalItems.map(renderToolLink)}
                        </ul>
                    )}
                </nav>

                {/* User Footer */}
                <div className="p-5 border-t border-white/10 bg-black/10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full bg-[#03a9e7] flex items-center justify-center text-white text-sm font-bold shrink-0">
                            {initials}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                                {displayName || email?.split('@')[0] || ' '}
                            </p>
                            <p className="text-[11px] text-slate-400">
                                {isAdmin ? 'Administrator' : 'Partner Agent'}
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

            {/* Mobile "More" sheet — back-of-house, opened deliberately */}
            {moreOpen && (
                <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setMoreOpen(false)}>
                    <div className="absolute inset-0 bg-[rgba(5,45,74,0.55)]" />
                    <div
                        className="relative bg-white rounded-t-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-3 px-1">
                            <p className="text-sm font-bold text-[#052d4a] flex items-center gap-1.5">
                                <Lock size={13} className="text-slate-400" /> Internal
                            </p>
                            <button onClick={() => setMoreOpen(false)} className="p-1.5 text-slate-400" aria-label="Close">
                                <X size={18} />
                            </button>
                        </div>
                        <ul className="grid grid-cols-3 gap-2">
                            {internalItems.map(item => (
                                <li key={item.name}>
                                    <Link
                                        href={item.href}
                                        prefetch
                                        onClick={() => setMoreOpen(false)}
                                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-colors ${
                                            isActiveHref(pathname, item.href)
                                                ? 'border-[#03a9e7] bg-sky-50 text-[#03a9e7]'
                                                : 'border-slate-200 text-slate-600'
                                        }`}
                                    >
                                        <item.icon size={20} />
                                        <span className="text-[11px] font-semibold leading-tight">{item.name}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}

            {/* Mobile Bottom Tab Bar — frosted, safe-area aware */}
            <nav
                className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex ios-tabbar ios-blur"
                style={{ background: 'rgba(255,255,255,0.86)', borderTop: '1px solid #e2e8f0' }}
            >
                {mobileTabs.map((item) => {
                    const active = isActiveHref(pathname, item.href)
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            prefetch
                            className="pressable"
                            style={tabStyle(active)}
                        >
                            <item.icon size={22} strokeWidth={active ? 2.4 : 2} />
                            <span>{item.name}</span>
                        </Link>
                    )
                })}
                <button
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    className="pressable"
                    style={{ ...tabStyle(moreOpen || internalActive), background: 'none', border: 'none', cursor: 'pointer' }}
                >
                    <Lock size={22} strokeWidth={moreOpen || internalActive ? 2.4 : 2} />
                    <span>More</span>
                </button>
            </nav>

            {/* Page Content */}
            <div className="md:pl-[260px]">
                <div
                    className="px-4 pt-[calc(64px+env(safe-area-inset-top))] pb-[calc(72px+env(safe-area-inset-bottom))] md:px-8 md:py-7"
                    style={{ minHeight: '100dvh' }}
                >
                    <div className="max-w-[1200px] mx-auto">{children}</div>
                </div>
            </div>
        </div>
    )
}

function tabStyle(active: boolean): React.CSSProperties {
    return {
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
    }
}
