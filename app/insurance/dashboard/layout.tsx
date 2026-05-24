'use client'

import { ReactNode, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, usePathname } from 'next/navigation'
import { canAccessInsurance, getSafeRoute } from '@/lib/permissions'
import {
    LayoutDashboard,
    Briefcase,
    Users,
    LogOut,
    Settings,
    Menu,
    X,
    TrendingUp,
    Percent
} from 'lucide-react'

export default function DashboardLayout({
    children,
}: {
    children: ReactNode
}) {
    const router = useRouter()
    const pathname = usePathname()
    const [role, setRole] = useState<string | null>(null)
    const [email, setEmail] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [sidebarOpen, setSidebarOpen] = useState(true)

    useEffect(() => {
        const loadUser = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser()

            if (!user) {
                router.replace('/insurance/login')
                return
            }

            setEmail(user.email ?? null)

            const { data: profile } = await supabase
                .from('profiles')
                .select('role, app_type')
                .eq('id', user.id)
                .single()

            if (!profile || !canAccessInsurance(profile.role, profile.app_type)) {
                router.replace(getSafeRoute(profile?.role, profile?.app_type))
                return
            }

            setRole(profile.role ?? 'agent')
            setLoading(false)
        }

        loadUser()
    }, [router])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.push('/login')
    }

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: '#052d4a' }}>
            Loading...
        </div>
    )

    const navItems = [
        { name: 'Dashboard', href: '/insurance/dashboard', icon: LayoutDashboard },
        { name: 'Cases', href: '/insurance/dashboard/cases', icon: Briefcase },
        { name: 'Rates', href: '/insurance/dashboard/rates', icon: Percent },
    ]

    if (role === 'admin') {
        navItems.push({ name: 'User Management', href: '/insurance/dashboard/users', icon: Users })
        navItems.push({ name: 'Analytics', href: '/insurance/dashboard/analytics', icon: TrendingUp })
    }

    return (
        <div className="flex min-h-screen bg-slate-50 relative">
            {/* Mobile Toggle - Top Bar for Mobile */}
            <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#052d4a] border-b border-white/10 flex items-center px-4 z-[60]">
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                >
                    {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
                <div className="ml-4 flex items-center gap-2">
                    <img
                        src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                        alt="Logo"
                        className="w-8 h-8 rounded"
                    />
                    <span className="text-white font-bold text-sm">The Loan Connection</span>
                </div>
            </div>

            {/* Backdrop for mobile */}
            {sidebarOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`sidebar-container fixed inset-y-0 left-0 z-50 w-[260px] transform transition-transform duration-300 ease-in-out md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                {/* Brand Header */}
                <div className="p-6 border-b border-white/10">
                    <div className="flex items-center gap-3">
                        <img
                            src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                            alt="The Loan Connection Logo"
                            className="w-10 h-10 rounded"
                        />
                        <h1 className="text-base font-bold text-white leading-tight">
                            The Loan Connection
                        </h1>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-6 overflow-y-auto">
                    <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                        Main Menu
                    </p>
                    <ul className="space-y-1">
                        {navItems.map((item) => {
                            const isActive = pathname === item.href || (item.href !== '/insurance/dashboard' && pathname?.startsWith(item.href))
                            return (
                                <li key={item.name}>
                                    <a
                                        href={item.href}
                                        className={`sidebar-link ${isActive ? 'active' : ''}`}
                                        onClick={() => {
                                            if (window.innerWidth < 768) setSidebarOpen(false)
                                        }}
                                    >
                                        <item.icon size={20} />
                                        <span>{item.name}</span>
                                    </a>
                                </li>
                            )
                        })}
                    </ul>
                </nav>

                {/* User Footer */}
                <div className="p-5 border-t border-white/10 bg-black/10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 rounded-full bg-[#03a9e7] flex items-center justify-center text-white text-sm font-bold shrink-0">
                            {email ? email[0].toUpperCase() : 'U'}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                                {email?.split('@')[0]}
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

            {/* Main Content Area */}
            <main className={`flex-1 transition-all duration-300 ease-in-out min-w-0 ${sidebarOpen ? 'md:ml-[260px]' : 'ml-0'
                }`}>
                <div className={`${pathname === '/insurance/dashboard/rates' ? 'h-screen overflow-hidden p-0' : 'p-4 md:p-8 pt-20 md:pt-8'} w-full`}>
                    <div className={`${pathname === '/insurance/dashboard/rates' ? 'h-full flex flex-col' : 'max-w-[1200px] mx-auto'}`}>
                        {children}
                    </div>
                </div>
            </main>
        </div>
    )
}
