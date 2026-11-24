'use client'

import { ReactNode, useEffect, useState, useSyncExternalStore, type ElementType } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { useRouter, usePathname } from 'next/navigation'
import { accountLabel, canAccessAdmin, getSafeRoute } from '@/lib/permissions'
import {
    LayoutDashboard, Users, BarChart3, DollarSign, LogOut, Menu, X, Building2, Bell, ClipboardList, Percent, BookOpen,
    Newspaper, CalendarClock, Landmark, History, Gift, Target, Wallet, PanelLeftClose, PanelLeftOpen, Sparkles,
} from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import AccountSwitcher from '@/components/shared/AccountSwitcher'
import { removeLinkedAccount, saveLinkedAccount } from '@/lib/auth/accountSwitcher'
import { clearCaseCaches } from '@/lib/insurance/caseCache'

interface NavItem {
    name: string
    href: string
    icon: ElementType
    /** Other routes that belong to this item. */
    also?: string[]
}

// Grouped by what the screen is FOR. Finance comes first: payouts are what admin
// is opened for. Labels are plan names; URLs keep the original app names.
const NAV: { label: string; items: NavItem[] }[] = [
    { label: '', items: [{ name: 'Home', href: '/admin', icon: LayoutDashboard }] },
    {
        label: 'Finance',
        items: [
            { name: 'TLC Dashboard', href: '/admin/finance', icon: BarChart3 },
            { name: 'Payouts', href: '/admin/payouts', icon: Wallet, also: ['/admin/insurance/earnings'] },
        ],
    },
    {
        label: 'Premium',
        items: [
            { name: 'Cases', href: '/admin/insurance/cases', icon: ClipboardList },
            { name: 'Action Centre', href: '/admin/insurance/follow-ups', icon: Target },
        ],
    },
    {
        label: 'Content',
        items: [
            { name: 'Rates', href: '/admin/insurance/rates', icon: Percent },
            { name: 'Bank Promotions', href: '/admin/insurance/promotions', icon: Gift },
            { name: 'Knowledge', href: '/admin/insurance/knowledge', icon: BookOpen },
            { name: 'Mortgage News', href: '/admin/insurance/news', icon: Newspaper },
            { name: 'Economic Calendar', href: '/admin/insurance/calendar', icon: CalendarClock },
            { name: "Banks' Insights", href: '/admin/insurance/bank-intelligence', icon: Landmark },
        ],
    },
    {
        label: 'Basic & Starter',
        items: [
            { name: 'Cases', href: '/admin/property/cases', icon: Building2 },
            { name: 'Earnings', href: '/admin/property/earnings', icon: DollarSign },
            { name: 'Dashboard', href: '/admin/property/analytics', icon: BarChart3 },
            { name: 'Reminders', href: '/admin/property/reminders', icon: Bell },
        ],
    },
    {
        label: 'System',
        items: [
            { name: 'Users', href: '/admin/users', icon: Users },
            { name: 'Audit Log', href: '/admin/audit-log', icon: History },
            { name: 'AI Spend', href: '/admin/ai-spend', icon: Sparkles },
        ],
    },
]

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`)
function isActive(pathname: string, item: NavItem) {
    if (item.href === '/admin') return pathname === '/admin'
    return [item.href, ...(item.also ?? [])].some(h => under(pathname, h))
}

// Icon rail, remembered per device. Collapsed by default below 1024px (iPad portrait).
const RAIL_KEY = 'hub-admin-sidebar-collapsed'
const railStore = {
    listeners: new Set<() => void>(),
    subscribe(cb: () => void): () => void {
        railStore.listeners.add(cb)
        window.addEventListener('storage', cb)
        window.addEventListener('resize', cb)
        return () => {
            railStore.listeners.delete(cb)
            window.removeEventListener('storage', cb)
            window.removeEventListener('resize', cb)
        }
    },
    get(): boolean {
        try {
            const saved = localStorage.getItem(RAIL_KEY)
            if (saved !== null) return saved === '1'
        } catch { /* private mode */ }
        return window.innerWidth < 1024
    },
    serverGet(): boolean { return false },
    set(v: boolean) {
        try { localStorage.setItem(RAIL_KEY, v ? '1' : '0') } catch { /* ignore */ }
        railStore.listeners.forEach(l => l())
    },
}

export default function AdminLayout({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname() ?? ''
    const [role, setRole] = useState<string | null>(null)
    const [email, setEmail] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [menuOpen, setMenuOpen] = useState(false)   // phone only
    const rail = useSyncExternalStore(railStore.subscribe, railStore.get, railStore.serverGet)

    useEffect(() => {
        const loadUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.replace('/login'); return }
            setEmail(user.email ?? null)

            const { data: profile } = await supabase.from('profiles').select('role, app_type, name').eq('id', user.id).single()
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
                    userId: user.id, email: user.email ?? '', name: profile.name ?? null, role: profile.role, appType: profile.app_type,
                    accessToken: session.access_token, refreshToken: session.refresh_token,
                })
            }
            setRole(profile.role)
            setDisplayName(profile.name ?? null)
            setLoading(false)
        }
        loadUser()
    }, [router])

    const handleSignOut = async () => {
        clearCaseCaches()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) removeLinkedAccount(user.id)
        await supabase.auth.signOut()
        router.push('/login')
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <Spinner size="lg" color="#03a9e7" label="Loading…" />
            </div>
        )
    }

    const nav = (compact: boolean) => NAV.map((section, i) => (
        <div key={section.label || 'home'} className={i ? 'mt-4' : ''}>
            {i > 0 && (compact
                ? <div className="border-t border-white/10 mb-3 mx-2" />
                : <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-1.5">{section.label}</p>)}
            <ul className="space-y-1">
                {section.items.map(item => {
                    const active = isActive(pathname, item)
                    const title = section.label && compact ? `${section.label}: ${item.name}` : item.name
                    return (
                        <li key={item.href}>
                            <Link href={item.href} title={compact ? title : undefined} aria-label={compact ? title : undefined}
                                aria-current={active ? 'page' : undefined} onClick={() => setMenuOpen(false)}
                                className={`sidebar-link min-h-[44px] text-sm ${compact ? 'justify-center' : ''} ${active ? 'active' : ''}`}
                                style={compact ? { paddingLeft: active ? 0 : 3, paddingRight: 0 } : undefined}>
                                <item.icon size={compact ? 22 : 18} />
                                {!compact && <span>{item.name}</span>}
                            </Link>
                        </li>
                    )
                })}
            </ul>
        </div>
    ))

    const footer = (
        <div className="p-5 border-t border-white/10 bg-black/10 shrink-0">
            <div className="mb-4">
                <AccountSwitcher
                    email={email}
                    displayName={displayName}
                    roleLabel={accountLabel(role as Parameters<typeof accountLabel>[0], null)}
                    avatarColor="#03a9e7"
                    onSignOut={handleSignOut}
                    alwaysShowMenu
                    addAccountLinks={[
                        { label: 'Add admin login', href: '/login' },
                        { label: 'Add Premium login', href: '/insurance/login' },
                        { label: 'Add Basic / Starter login', href: '/property/login?add=1' },
                    ]}
                />
            </div>
            <button onClick={handleSignOut} className="flex items-center gap-2 text-slate-400 hover:text-red-400 transition-colors text-xs font-medium">
                <LogOut size={16} /> Sign Out
            </button>
        </div>
    )

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Phone top bar */}
            <div className="md:hidden fixed top-0 left-0 right-0 h-14 flex items-center px-3 z-40 bg-[#052d4a]">
                <button onClick={() => setMenuOpen(true)} aria-label="Open menu" className="w-11 h-11 flex items-center justify-center text-white rounded-lg hover:bg-white/10"><Menu size={22} /></button>
                <span className="ml-2 text-white font-bold text-sm">TLC HUB Admin</span>
            </div>
            {menuOpen && (
                <div className="md:hidden fixed inset-0 z-50 flex">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
                    <aside className="relative w-[280px] max-w-[85vw] flex flex-col sidebar-container">
                        <div className="p-4 flex items-center justify-between border-b border-white/10">
                            <span className="text-white font-bold">TLC HUB Admin</span>
                            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="w-11 h-11 flex items-center justify-center text-slate-300"><X size={20} /></button>
                        </div>
                        <nav className="flex-1 min-h-0 overflow-y-auto px-3 py-4">{nav(false)}</nav>
                        {footer}
                    </aside>
                </div>
            )}

            {/* iPad / desktop sidebar */}
            <aside className="hidden md:flex flex-col fixed inset-y-0 left-0 z-40 sidebar-container transition-[width] duration-200" style={{ width: rail ? 72 : 260 }}>
                {rail ? (
                    <div className="py-5 border-b border-white/10 flex flex-col items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/brand/tlc-logo.png" alt="The Loan Connection" className="w-9 h-9 rounded" />
                        <button type="button" onClick={() => railStore.set(false)} title="Expand sidebar" aria-label="Expand sidebar"
                            className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-300 bg-white/5 hover:bg-white/15 hover:text-white"><PanelLeftOpen size={22} /></button>
                    </div>
                ) : (
                    <div className="p-5 pr-3 border-b border-white/10 flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/brand/tlc-logo.png" alt="" className="w-10 h-10 rounded" />
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-white leading-tight">TLC HUB Admin</p>
                            <p className="text-[11px] text-[#7dd3fc]">The Loan Connection</p>
                        </div>
                        <button type="button" onClick={() => railStore.set(true)} title="Collapse sidebar" aria-label="Collapse sidebar"
                            className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white"><PanelLeftClose size={20} /></button>
                    </div>
                )}
                <nav className={`flex-1 min-h-0 py-4 overflow-y-auto ${rail ? 'px-2' : 'px-3'}`}>{nav(rail)}</nav>
                {rail ? (
                    <div className="py-4 border-t border-white/10 bg-black/10 flex flex-col items-center gap-3">
                        <button type="button" onClick={() => railStore.set(false)} title={displayName || email || 'Account'} aria-label="Open sidebar to switch account"
                            className="w-10 h-10 rounded-full bg-[#03a9e7] text-white text-sm font-bold">{(displayName || email || '?').trim().charAt(0).toUpperCase()}</button>
                        <button type="button" onClick={handleSignOut} title="Sign out" aria-label="Sign out" className="w-10 h-10 rounded-lg flex items-center justify-center text-[#ee3238] hover:bg-white/10"><LogOut size={18} /></button>
                    </div>
                ) : footer}
            </aside>

            <main className={`min-w-0 transition-[margin] duration-200 ${rail ? 'md:ml-[72px]' : 'md:ml-[260px]'}`}>
                <div className="p-4 md:p-6 lg:p-8 pt-[72px] md:pt-6 lg:pt-8 w-full">
                    <div className="max-w-[1200px] mx-auto">{children}</div>
                </div>
            </main>
        </div>
    )
}
