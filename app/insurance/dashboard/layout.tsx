'use client'

import { ReactNode, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import { canAccessInsurance, getSafeRoute, isAdmin as isAdminRole } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/shared'
import { clearCaseCaches } from '@/lib/insurance/caseCache'
import { removeLinkedAccount, saveLinkedAccount } from '@/lib/auth/accountSwitcher'
import AccountSwitcher from '@/components/shared/AccountSwitcher'
import { needsReconsent } from '@/lib/legal/checkConsent'
import {
    LayoutDashboard,
    Briefcase,
    LogOut,
    Percent,
    UserCircle,
    BookOpen,
    Clock,
    LayoutGrid,
    Calculator,
    Receipt,
    Scale,
    FileText,
    LifeBuoy,
    ChevronDown,
    ChevronRight,
    Lock,
    X,
    BarChart2,
    DollarSign,
    Landmark,
} from 'lucide-react'

type NavChild = { name: string; href: string }
type NavItem = { name: string; href: string; icon: React.ElementType; soon?: boolean; children?: NavChild[] }

// ── Front-of-house ("Tools") — client-safe. These are the screens an agent uses
//    WHILE sitting with a client. Nothing here reveals other clients or the
//    agent's own sales pipeline, so the app is safe to leave open on a tablet.
//
// Calculators/Resources carry `children` so their sub-pages are reachable
// directly from the sidebar (desktop) instead of only via an intermediate
// gallery/tab page. Mobile keeps using the parent href as a bottom tab, which
// still lands on that gallery/tab page — nesting only changes desktop nav.
const toolsNav: NavItem[] = [
    { name: 'Mortgage Planner', href: '/insurance/dashboard', icon: LayoutGrid },
    {
        name: 'Calculators',
        href: '/insurance/dashboard/calculators',
        icon: Calculator,
        children: [
            { name: 'Amortization', href: '/insurance/dashboard/calculators/amortization' },
            { name: 'Affordability', href: '/insurance/dashboard/calculators/tdsr' },
            { name: 'Technical TDSR', href: '/insurance/dashboard/calculators/technical-tdsr' },
            { name: 'Reverse Affordability', href: '/insurance/dashboard/calculators/affordability' },
            { name: 'BUC', href: '/insurance/dashboard/calculators/buc' },
            { name: 'Partial Repayment', href: '/insurance/dashboard/calculators/partial-repayment' },
            { name: 'Stamp Duty', href: '/insurance/dashboard/calculators/stamp-duty' },
        ],
    },
    { name: 'Knowledge', href: '/insurance/dashboard/knowledge', icon: BookOpen },
    { name: 'Rates', href: '/insurance/dashboard/rates', icon: Percent },
    {
        name: 'Resources',
        href: '/insurance/dashboard/resources',
        icon: BarChart2,
        children: [
            { name: 'SORA / FFR Trend', href: '/insurance/dashboard/resources/rates' },
            { name: 'Domestic Rates', href: '/insurance/dashboard/resources/domestic' },
            { name: 'Mortgage News', href: '/insurance/dashboard/resources/news' },
            { name: 'Economic Calendar', href: '/insurance/dashboard/resources/calendar' },
        ],
    },
    { name: "Banks' Insights", href: '/insurance/dashboard/bank-intelligence', icon: Landmark },
    { name: 'Document Guide', href: '/insurance/dashboard/documents', icon: FileText },
    { name: 'Valuation Fees', href: '/insurance/dashboard/valuation', icon: Receipt },
    { name: 'Legal', href: '/insurance/dashboard/legal', icon: Scale },
]

// ── Back-of-house ("Internal") — cross-client / sales data. Tucked behind a
//    collapsed dropdown and a "More" sheet on mobile so a client glancing at the
//    screen never sees the pipeline, other clients' names, or follow-ups.
const internalNav: NavItem[] = [
    { name: 'Dashboard', href: '/insurance/dashboard/pipeline', icon: LayoutDashboard },
    { name: 'Cases', href: '/insurance/dashboard/cases', icon: Briefcase },
    { name: 'Earnings', href: '/insurance/dashboard/earnings', icon: DollarSign },
    { name: 'Follow ups', href: '/insurance/dashboard/followup', icon: Clock },
    { name: 'Support', href: '/insurance/dashboard/support', icon: LifeBuoy, soon: true },
    { name: 'Profile', href: '/insurance/dashboard/profile', icon: UserCircle },
]

// Admin management (Users, Analytics, Cases oversight, etc.) now lives in the
// dedicated ops console at /admin/insurance/* — admins are redirected there.

// Mobile bottom tab bar shows the 4 primary client-safe tools; everything
// internal lives behind the "More" tab.
const mobileTabs = toolsNav.filter(t => !t.soon).slice(0, 4)

// A case-detail URL (e.g. /insurance/dashboard/cases/<id>) is the client-facing
// case screen, not the internal case list — even though it shares the /cases
// prefix. Excluding it here keeps "Internal" from auto-expanding while an agent
// has a case open in front of a client. The list itself and the internal utility
// pages (/cases/new, /cases/lock-in-end) still count as internal.
function isCaseDetailRoute(pathname: string | null) {
    const match = pathname?.match(/^\/insurance\/dashboard\/cases\/([^/]+)/)
    return !!match && match[1] !== 'new' && match[1] !== 'lock-in-end'
}

function isActiveHref(pathname: string | null, href: string) {
    if (href === '/insurance/dashboard/cases' && isCaseDetailRoute(pathname)) return false
    return pathname === href || (href !== '/insurance/dashboard' && !!pathname?.startsWith(href))
}

// A group (Calculators/Resources) is active if the current route is any of its
// children, or the parent itself — checked separately from isActiveHref because
// Resources' parent href redirects elsewhere, so pathname never literally
// equals/starts-with it once a child page loads.
function isGroupActive(pathname: string | null, item: NavItem) {
    if (item.children?.some(c => isActiveHref(pathname, c.href))) return true
    return isActiveHref(pathname, item.href)
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const [role, setRole] = useState<string | null>(null)
    const [email, setEmail] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState<string | null>(null)

    const isAdmin = role != null && isAdminRole(role as UserRole)
    const internalItems = internalNav
    const internalActive = internalItems.some(i => isActiveHref(pathname, i.href))

    // Internal is collapsed by default (back-of-house); it also stays expanded
    // whenever the current route already lives inside it, so deep links never look
    // broken. Derived (not an effect) to avoid cascading re-renders.
    const [internalOpen, setInternalOpen] = useState(false)
    const internalExpanded = internalOpen || internalActive
    const [moreOpen, setMoreOpen] = useState(false)

    // Which Calculators/Resources-style groups are manually expanded. A group
    // also auto-expands whenever the active route already lives inside it
    // (see isGroupActive), same as the Internal section above.
    const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
    const toggleGroup = (name: string) => {
        setOpenGroups(prev => {
            const next = new Set(prev)
            if (next.has(name)) next.delete(name)
            else next.add(name)
            return next
        })
    }

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
                .select('role, app_type, name, status, onboarding')
                .eq('id', user.id)
                .single()
            if (!active) return

            if (!profile || !canAccessInsurance(profile.role, profile.app_type)) {
                router.replace(profile ? getSafeRoute(profile.role, profile.app_type) : '/insurance/login')
                return
            }

            // Seed/refresh the account switcher cache on every load (not just at
            // login) — otherwise a session that was already active before this
            // feature shipped never gets captured.
            const { data: { session } } = await supabase.auth.getSession()
            if (active && session) {
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

            if (profile.status === 'disabled') {
                await supabase.auth.signOut()
                router.replace('/insurance/login?error=account_disabled')
                return
            }

            if (await needsReconsent(supabase, user.id)) {
                router.replace('/consent/renew')
                return
            }

            // Admins run the operation from the ops console, not the agent app.
            if (isAdminRole(profile.role)) {
                router.replace('/admin/insurance/cases')
                return
            }

            // First-login onboarding — walk new agents through profile completion
            // and a product tour before they reach the dashboard.
            if (!profile.onboarding?.completed_at) {
                router.replace('/insurance/onboarding')
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
        clearCaseCaches()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) removeLinkedAccount(user.id)
        await supabase.auth.signOut()
        router.push('/insurance/login')
    }

    const renderToolLink = (item: NavItem) => {
        const hasChildren = !!item.children?.length
        if (!hasChildren) {
            return (
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
        }

        const active = isGroupActive(pathname, item)
        const expanded = openGroups.has(item.name) || active
        return (
            <li key={item.name}>
                <div className={`sidebar-link ${active ? 'active' : ''}`} style={{ paddingRight: 6 }}>
                    <Link
                        href={item.href}
                        prefetch
                        className="flex items-center gap-3 flex-1 min-w-0 text-inherit no-underline"
                    >
                        <item.icon size={20} />
                        <span className="flex-1 truncate">{item.name}</span>
                    </Link>
                    <button
                        type="button"
                        onClick={() => toggleGroup(item.name)}
                        aria-label={expanded ? `Collapse ${item.name}` : `Expand ${item.name}`}
                        aria-expanded={expanded}
                        className="p-1 -mr-1 shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                    >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                </div>
                {expanded && (
                    <ul className="mt-0.5 mb-1 space-y-0.5">
                        {item.children!.map(child => (
                            <li key={child.href}>
                                <Link
                                    href={child.href}
                                    prefetch
                                    className={`sidebar-sublink ${isActiveHref(pathname, child.href) ? 'active' : ''}`}
                                >
                                    {child.name}
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </li>
        )
    }

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
                    <div className="mb-4">
                        <AccountSwitcher
                            email={email}
                            displayName={displayName}
                            roleLabel={isAdmin ? 'Administrator' : 'Partner Agent'}
                            avatarColor="#03a9e7"
                            onSignOut={handleSignOut}
                            addAccountLinks={[
                                { label: 'Add insurance agent login', href: '/insurance/login' },
                                { label: 'Add property agent login', href: '/property/login?add=1' },
                                { label: 'Add admin login', href: '/login' },
                            ]}
                        />
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
