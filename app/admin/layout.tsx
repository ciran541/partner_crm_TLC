'use client'

import { ReactNode, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, usePathname } from 'next/navigation'
import { canAccessAdmin, getSafeRoute } from '@/lib/permissions'
import {
    LayoutDashboard,
    Users,
    BarChart3,
    BarChart2,
    LogOut,
    Menu,
    X,
    Shield,
    Building2,
    Bell,
    ClipboardList,
    Percent,
    BookOpen,
    Clock,
    Newspaper,
    CalendarClock,
    Landmark,
    History,
    Gift,
} from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import AccountSwitcher from '@/components/shared/AccountSwitcher'
import { removeLinkedAccount, saveLinkedAccount } from '@/lib/auth/accountSwitcher'

export default function AdminLayout({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [role, setRole] = useState<string | null>(null)
    const [email, setEmail] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [sidebarOpen, setSidebarOpen] = useState(true)

    useEffect(() => {
        const loadUser = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser()

            if (!user) {
                router.replace('/login')
                return
            }

            setEmail(user.email ?? null)

            const { data: profile } = await supabase
                .from('profiles')
                .select('role, app_type, name')
                .eq('id', user.id)
                .single()

            if (!profile || !canAccessAdmin(profile.role)) {
                router.replace(getSafeRoute(profile?.role, profile?.app_type))
                return
            }

            // Seed/refresh the account switcher cache on every load (not just at
            // login) — otherwise a session that was already active before this
            // feature shipped never gets captured.
            const { data: { session } } = await supabase.auth.getSession()
            if (session) {
                saveLinkedAccount({
                    userId: user.id,
                    email: user.email ?? '',
                    name: profile.name ?? null,
                    role: profile.role,
                    appType: profile.app_type,
                    accessToken: session.access_token,
                    refreshToken: session.refresh_token,
                })
            }

            setRole(profile.role)
            setDisplayName(profile.name ?? null)
            setLoading(false)
        }

        loadUser()
    }, [router])

    const handleSignOut = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) removeLinkedAccount(user.id)
        await supabase.auth.signOut()
        router.push('/login')
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <Spinner size="lg" color="#8b5cf6" label="Loading…" />
            </div>
        )
    }

    const coreNavItems = [
        { name: 'Admin Home', href: '/admin', icon: LayoutDashboard },
        { name: 'Users', href: '/admin/users', icon: Users },
        { name: 'Audit Log', href: '/admin/audit-log', icon: History },
    ]

    const insuranceNavItems = [
        { name: 'Insurance Cases', href: '/admin/insurance/cases', icon: ClipboardList },
        { name: 'Insurance Earnings', href: '/admin/insurance/earnings', icon: BarChart2 },
        { name: 'Insurance Analytics', href: '/admin/insurance/analytics', icon: BarChart3 },
        { name: 'Insurance Follow-ups', href: '/admin/insurance/follow-ups', icon: Clock },
        { name: 'Insurance Rates', href: '/admin/insurance/rates', icon: Percent },
        { name: 'Bank Promotions', href: '/admin/insurance/promotions', icon: Gift },
        { name: 'Insurance Knowledge', href: '/admin/insurance/knowledge', icon: BookOpen },
        { name: 'Mortgage News', href: '/admin/insurance/news', icon: Newspaper },
        { name: 'Economic Calendar', href: '/admin/insurance/calendar', icon: CalendarClock },
        { name: "Banks' Insights", href: '/admin/insurance/bank-intelligence', icon: Landmark },
    ]

    const propertyNavItems = [
        { name: 'Property Cases', href: '/admin/property/cases', icon: Building2 },
        { name: 'Property Analytics', href: '/admin/property/analytics', icon: BarChart2 },
        { name: 'Property Reminders', href: '/admin/property/reminders', icon: Bell },
    ]

    return (
        <div className="flex min-h-screen bg-slate-50 relative">
            {/* Mobile Top Bar */}
            <div className="md:hidden fixed top-0 left-0 right-0 h-16 border-b border-white/10 flex items-center px-4 z-[60]"
                style={{ background: '#1e1b4b' }}>
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                    {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
                <div className="ml-4 flex items-center gap-2">
                    <Shield size={20} className="text-purple-300" />
                    <span className="text-white font-bold text-sm">TLC Admin</span>
                </div>
            </div>

            {/* Backdrop */}
            {sidebarOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col overflow-hidden transform transition-transform duration-300 ease-in-out md:translate-x-0 ${
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
                style={{ background: '#1e1b4b', color: 'white' }}
            >
                {/* Brand Header */}
                <div className="p-6 border-b border-white/10 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                            <Shield size={20} className="text-purple-300" />
                        </div>
                        <div>
                            <h1 className="text-sm font-bold text-white leading-tight">Super Admin</h1>
                            <p className="text-[11px] text-purple-300">The Loan Connection</p>
                        </div>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 min-h-0 px-3 py-6 overflow-y-auto">
                    <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                        Core
                    </p>
                    <ul className="space-y-1">
                        {coreNavItems.map((item) => {
                            const isActive =
                                pathname === item.href ||
                                (item.href !== '/admin' && pathname?.startsWith(item.href))
                            return (
                                <li key={item.name}>
                                    <a
                                        href={item.href}
                                        className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                            isActive
                                                ? 'bg-purple-500/20 text-white border-l-[3px] border-purple-400 pr-4'
                                                : 'text-slate-300 hover:text-white hover:bg-white/10 px-4'
                                        }`}
                                        style={isActive ? { paddingLeft: 13 } : undefined}
                                        onClick={() => {
                                            if (window.innerWidth < 768) setSidebarOpen(false)
                                        }}
                                    >
                                        <item.icon size={18} />
                                        <span>{item.name}</span>
                                    </a>
                                </li>
                            )
                        })}
                    </ul>

                    <hr className="border-white/10 my-4" />

                    <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                        Insurance Platform
                    </p>
                    <ul className="space-y-1">
                        {insuranceNavItems.map((item) => {
                            const isActive = pathname?.startsWith(item.href)
                            return (
                                <li key={item.name}>
                                    <a
                                        href={item.href}
                                        className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                            isActive
                                                ? 'bg-purple-500/20 text-white border-l-[3px] border-purple-400 pr-4'
                                                : 'text-slate-300 hover:text-white hover:bg-white/10 px-4'
                                        }`}
                                        style={isActive ? { paddingLeft: 13 } : undefined}
                                        onClick={() => { if (window.innerWidth < 768) setSidebarOpen(false) }}
                                    >
                                        <item.icon size={18} />
                                        <span>{item.name}</span>
                                    </a>
                                </li>
                            )
                        })}
                    </ul>

                    <hr className="border-white/10 my-4" />

                    <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                        Property Platform
                    </p>
                    <ul className="space-y-1">
                        {propertyNavItems.map((item) => {
                            const isActive = pathname?.startsWith(item.href)
                            return (
                                <li key={item.name}>
                                    <a
                                        href={item.href}
                                        className={`flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                                            isActive
                                                ? 'bg-purple-500/20 text-white border-l-[3px] border-purple-400 pr-4'
                                                : 'text-slate-300 hover:text-white hover:bg-white/10 px-4'
                                        }`}
                                        style={isActive ? { paddingLeft: 13 } : undefined}
                                        onClick={() => {
                                            if (window.innerWidth < 768) setSidebarOpen(false)
                                        }}
                                    >
                                        <item.icon size={18} />
                                        <span>{item.name}</span>
                                    </a>
                                </li>
                            )
                        })}
                    </ul>

                </nav>

                {/* User Footer */}
                <div className="p-5 border-t border-white/10 shrink-0" style={{ background: 'rgba(0,0,0,0.15)' }}>
                    <div className="mb-4">
                        <AccountSwitcher
                            email={email}
                            displayName={displayName}
                            roleLabel="Super Admin"
                            avatarColor="#a855f7"
                            onSignOut={handleSignOut}
                            alwaysShowMenu
                            addAccountLinks={[
                                { label: 'Add admin login', href: '/login' },
                                { label: 'Add insurance agent login', href: '/insurance/login' },
                            ]}
                        />
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 text-slate-400 hover:text-red-400 transition-colors text-xs font-medium"
                    >
                        <LogOut size={16} />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main
                className={`flex-1 transition-all duration-300 ease-in-out min-w-0 ${
                    sidebarOpen ? 'md:ml-[260px]' : 'ml-0'
                }`}
            >
                <div className="p-4 md:p-8 pt-20 md:pt-8 w-full">
                    <div className="max-w-[1200px] mx-auto">{children}</div>
                </div>
            </main>
        </div>
    )
}
