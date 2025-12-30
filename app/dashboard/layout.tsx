'use client'

import { ReactNode, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, usePathname } from 'next/navigation'
import {
    LayoutDashboard,
    Briefcase,
    Users,
    LogOut,
    Settings,
    Menu,
    X,
    TrendingUp
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
                router.replace('/login')
                return
            }

            setEmail(user.email ?? null)

            const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', user.id)
                .single()

            setRole(profile?.role ?? 'agent')
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
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { name: 'Cases', href: '/dashboard/cases', icon: Briefcase },
        // Placeholder for future features matching the sidebar wish
        // { name: 'Analytics', href: '/dashboard/analytics', icon: TrendingUp },
    ]

    if (role === 'admin') {
        navItems.push({ name: 'User Management', href: '/dashboard/users', icon: Users })
    }

    return (
        <div style={{ display: 'flex', minHeight: '100vh', background: '#f1f5f9' }}>
            {/* Mobile Toggle */}
            <button
                className="md:hidden"
                style={{ position: 'fixed', top: 10, left: 10, zIndex: 100, background: '#052d4a', color: 'white', padding: 8, borderRadius: 4, border: 'none' }}
                onClick={() => setSidebarOpen(!sidebarOpen)}
            >
                {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Sidebar */}
            <aside
                className={`sidebar-container ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
                style={{
                    width: 260,
                    position: 'fixed',
                    height: '100vh',
                    transition: 'transform 0.3s ease',
                    zIndex: 50,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '4px 0 10px rgba(0,0,0,0.1)'
                }}
            >
                {/* Brand Header */}
                <div style={{ padding: '24px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <img
                            src="https://theloanconnection.com.sg/wp-content/uploads/2025/02/TLC-Square-1.png"
                            alt="The Loan Connection Logo"
                            style={{ width: 40, height: 40, borderRadius: '4px' }}
                        />
                        <h1 style={{ fontSize: '16px', fontWeight: '700', margin: 0, lineHeight: 1.2, color: 'white' }}>
                            The Loan Connection
                        </h1>
                    </div>
                </div>

                {/* Navigation */}
                <nav style={{ flex: 1, padding: '24px 12px' }}>
                    <p style={{
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        color: '#64748b',
                        marginBottom: '12px',
                        paddingLeft: '12px',
                        fontWeight: '600'
                    }}>
                        Main Menu
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {navItems.map((item) => {
                            const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href))
                            return (
                                <li key={item.name} style={{ marginBottom: '4px' }}>
                                    <a
                                        href={item.href}
                                        className={`sidebar-link ${isActive ? 'active' : ''}`}
                                    >
                                        <item.icon size={20} />
                                        {item.name}
                                    </a>
                                </li>
                            )
                        })}
                    </ul>
                </nav>

                {/* User Footer */}
                <div style={{ padding: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                        <div style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: '#03a9e7',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: 'bold'
                        }}>
                            {email ? email[0].toUpperCase() : 'U'}
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                            <p style={{ fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                                {email?.split('@')[0]}
                            </p>
                            <p style={{ fontSize: '11px', color: '#94a3b8' }}>
                                {role === 'admin' ? 'Administrator' : 'Partner Agent'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleSignOut}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            background: 'transparent',
                            border: 'none',
                            color: '#ee3238',
                            cursor: 'pointer',
                            fontSize: '13px',
                            padding: 0
                        }}>
                        <LogOut size={16} />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main Content Area */}
            <main style={{
                flex: 1,
                marginLeft: sidebarOpen ? 260 : 0,
                padding: '32px',
                background: '#f1f5f9',
                color: '#0f172a',
                transition: 'margin 0.3s ease',
                width: '100%',
                maxWidth: '100vw'
            }}>
                <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                    {children}
                </div>
            </main>
        </div>
    )
}
