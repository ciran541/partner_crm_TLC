'use client'

import { ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import { canAccessInsurance, getSafeRoute, isAdmin as isAdminRole } from '@/lib/permissions'
import type { UserRole } from '@/lib/types/shared'
import { clearCaseCaches } from '@/lib/insurance/caseCache'
import { actionCentreStore } from '@/lib/insurance/actionCentreStore'
import { NOW_KEY, type ActionMeta, type ActionRow } from '@/lib/insurance/actionCentre'
import { useList } from '@/lib/shared/useList'
import { removeLinkedAccount, saveLinkedAccount } from '@/lib/auth/accountSwitcher'
import AccountSwitcher from '@/components/shared/AccountSwitcher'
import { needsReconsent } from '@/lib/legal/checkConsent'
import {
    MoreHorizontal,
    LayoutDashboard,
    Briefcase,
    LogOut,
    Percent,
    UserCircle,
    BookOpen,
    Target,
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
    PanelLeftClose,
    PanelLeftOpen,
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
const ACTION_CENTRE_HREF = '/insurance/dashboard/action-centre'
const internalNav: NavItem[] = [
    { name: 'Dashboard', href: '/insurance/dashboard/pipeline', icon: LayoutDashboard },
    { name: 'Cases', href: '/insurance/dashboard/cases', icon: Briefcase },
    { name: 'Earnings', href: '/insurance/dashboard/earnings', icon: DollarSign },
    { name: 'Action Centre', href: ACTION_CENTRE_HREF, icon: Target },
    { name: 'Support', href: '/insurance/dashboard/support', icon: LifeBuoy, soon: true },
    { name: 'Profile', href: '/insurance/dashboard/profile', icon: UserCircle },
]

// Admin management (Users, Analytics, Cases oversight, etc.) now lives in the
// dedicated ops console at /admin/insurance/* — admins are redirected there.

// Mobile bottom tab bar shows the 4 primary client-safe tools. The "More" sheet
// holds every other tool (Resources, Banks' Insights, Document Guide, Valuation
// Fees, Legal…) first, then the Internal items — so every page in the sidebar is
// reachable on a phone. Derived from toolsNav, so a new tool appears here too.
const mobileTabs = toolsNav.filter(t => !t.soon).slice(0, 4)
const moreTools = toolsNav.filter(t => !t.soon && !mobileTabs.includes(t))

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

// ── Collapsible sidebar ("rail") ─────────────────────────────────────────────
// On iPad the full 260px sidebar eats ~a third of a portrait screen, so it can
// collapse to a 72px icon rail. The choice is remembered per device; with no
// saved choice it starts collapsed below 1024px (iPad portrait) and open on
// wider screens — and follows rotation until the agent picks. Read through
// useSyncExternalStore (localStorage doesn't exist during the server render).
const RAIL_KEY = 'hub-sidebar-collapsed'
const RAIL_WIDTH = 72
const SIDEBAR_WIDTH = 260
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
        } catch { /* private mode: fall through to the width default */ }
        return window.innerWidth < 1024
    },
    serverGet(): boolean { return false },
    set(collapsed: boolean) {
        try { localStorage.setItem(RAIL_KEY, collapsed ? '1' : '0') } catch { /* ignore */ }
        railStore.listeners.forEach(l => l())
    },
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
    const moreToolsActive = moreTools.some(t => isGroupActive(pathname, t))

    // Internal is collapsed by default (back-of-house); it also stays expanded
    // whenever the current route already lives inside it, so deep links never look
    // broken. Derived (not an effect) to avoid cascading re-renders.
    const [internalOpen, setInternalOpen] = useState(false)
    // Overdue follow-ups, shown as a red count on the Action Centre link. Only
    // visible once Internal is open, so a client glancing at the screen never sees it.
    // Same request as the Action Centre page (so opening it is instant); re-read
    // on navigation only once it is out of date.
    const { meta } = useList<ActionRow, ActionMeta>(actionCentreStore, NOW_KEY)
    const overdueCount = meta?.counts.overdue ?? 0
    useEffect(() => { actionCentreStore.ensure(NOW_KEY) }, [pathname])
    const internalExpanded = internalOpen || internalActive
    const rail = useSyncExternalStore(railStore.subscribe, railStore.get, railStore.serverGet)
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
        if (rail) {
            const active = hasChildren ? isGroupActive(pathname, item) : isActiveHref(pathname, item.href)
            const showDot = item.href === ACTION_CENTRE_HREF && overdueCount > 0
            return (
                <li key={item.name}>
                    <Link
                        href={item.href}
                        prefetch
                        title={item.name}
                        aria-label={item.name}
                        className={`sidebar-link relative justify-center ${active ? 'active' : ''}`}
                        style={{ paddingLeft: active ? 0 : 3, paddingRight: 0 }}
                    >
                        <item.icon size={22} />
                        {showDot && (
                            <span className="absolute top-1.5 right-3 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-4 text-center">
                                {overdueCount > 9 ? '9+' : overdueCount}
                            </span>
                        )}
                    </Link>
                </li>
            )
        }
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
                        {item.href === ACTION_CENTRE_HREF && overdueCount > 0 && (
                            <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 min-w-[18px] text-center leading-[18px]"
                                title={`${overdueCount} overdue follow-up${overdueCount === 1 ? '' : 's'}`}>
                                {overdueCount > 99 ? '99+' : overdueCount}
                            </span>
                        )}
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
            <aside
                className="hidden md:flex flex-col fixed inset-y-0 left-0 z-40 sidebar-container transition-[width] duration-200"
                style={{ width: rail ? RAIL_WIDTH : SIDEBAR_WIDTH }}
            >
                {/* Brand + collapse / expand */}
                {rail ? (
                    <div className="py-5 border-b border-white/10 flex flex-col items-center gap-3">
                        <img src="/brand/tlc-logo.png" alt="The Loan Connection Logo" className="w-9 h-9 rounded" />
                        <button
                            type="button"
                            onClick={() => railStore.set(false)}
                            title="Expand sidebar"
                            aria-label="Expand sidebar"
                            className="w-11 h-11 rounded-xl flex items-center justify-center text-slate-300 bg-white/5 hover:bg-white/15 hover:text-white transition-colors"
                        >
                            <PanelLeftOpen size={22} />
                        </button>
                    </div>
                ) : (
                    <div className="p-6 pr-3 border-b border-white/10">
                        <div className="flex items-center gap-3">
                            <img
                                src="/brand/tlc-logo.png"
                                alt="The Loan Connection Logo"
                                className="w-10 h-10 rounded"
                            />
                            <div className="flex-1 min-w-0">
                                <p className="text-base font-bold text-white leading-tight">The Loan Connection</p>
                                <div className="flex items-center gap-1.5 mt-1">
                                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#03a9e7]" />
                                    <p className="text-[10px] font-semibold text-[#7dd3fc] tracking-wider">TLC HUB</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => railStore.set(true)}
                                title="Collapse sidebar"
                                aria-label="Collapse sidebar"
                                className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                            >
                                <PanelLeftClose size={20} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Navigation */}
                <nav className={`flex-1 py-6 overflow-y-auto ${rail ? 'px-2' : 'px-3'}`}>
                    {!rail && (
                        <p className="px-3 text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-4">
                            Tools
                        </p>
                    )}
                    <ul className="space-y-1">
                        {toolsNav.map(renderToolLink)}
                    </ul>

                    {/* Internal — collapsed back-of-house section */}
                    {rail ? (
                        // Rail: a lock button opens/closes the Internal icons; a line separates them.
                        <button
                            type="button"
                            onClick={() => setInternalOpen(o => !o)}
                            title={internalExpanded ? 'Hide Internal' : 'Show Internal'}
                            aria-label={internalExpanded ? 'Hide Internal' : 'Show Internal'}
                            aria-expanded={internalExpanded}
                            className={`w-full mt-5 mb-2 h-10 rounded-lg flex items-center justify-center gap-0.5 border-t border-white/10 pt-3 transition-colors ${
                                internalExpanded ? 'text-slate-200' : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Lock size={14} />
                            {internalExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setInternalOpen(o => !o)}
                            className="w-full mt-6 mb-2 px-3 flex items-center gap-2 text-[11px] font-semibold text-slate-400 uppercase tracking-widest hover:text-slate-200 transition-colors"
                        >
                            <Lock size={11} />
                            <span className="flex-1 text-left">Internal</span>
                            {internalExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </button>
                    )}
                    {internalExpanded && (
                        <ul className="space-y-1">
                            {internalItems.map(renderToolLink)}
                        </ul>
                    )}
                </nav>

                {/* User Footer */}
                {rail ? (
                    <div className="py-4 border-t border-white/10 bg-black/10 flex flex-col items-center gap-3">
                        <button
                            type="button"
                            onClick={() => railStore.set(false)}
                            title={displayName || email || 'Account'}
                            aria-label="Open sidebar to switch account"
                            className="w-9 h-9 rounded-full bg-[#03a9e7] text-white text-sm font-bold flex items-center justify-center"
                        >
                            {(displayName || email || '?').trim().charAt(0).toUpperCase()}
                        </button>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            title="Sign out"
                            aria-label="Sign out"
                            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#ee3238] hover:bg-white/10 transition-colors"
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                ) : (
                <div className="p-5 border-t border-white/10 bg-black/10">
                    <div className="mb-4">
                        <AccountSwitcher
                            email={email}
                            displayName={displayName}
                            roleLabel={isAdmin ? 'Administrator' : 'Premium'}
                            avatarColor="#03a9e7"
                            onSignOut={handleSignOut}
                            addAccountLinks={[
                                { label: 'Add Premium login', href: '/insurance/login' },
                                { label: 'Add Basic / Starter login', href: '/property/login?add=1' },
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
                )}
            </aside>

            {/* Mobile Top Bar — brand + sign out */}
            <div
                className="md:hidden fixed top-0 left-0 right-0 z-50 ios-topbar ios-blur"
                style={{ background: 'rgba(5,45,74,0.92)' }}
            >
                <div className="flex items-center justify-between h-14 px-4">
                    <div className="flex items-center gap-2 min-w-0">
                        <img
                            src="/brand/tlc-logo.png"
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
                        className="relative bg-white rounded-t-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-2xl max-h-[85dvh] overflow-y-auto"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-3 px-1">
                            <p className="text-sm font-bold text-[#052d4a]">More tools</p>
                            <button onClick={() => setMoreOpen(false)} className="p-1.5 text-slate-400" aria-label="Close">
                                <X size={18} />
                            </button>
                        </div>
                        <ul className="grid grid-cols-3 gap-2 mb-5">
                            {moreTools.map(item => (
                                <li key={item.name}>
                                    <Link
                                        href={item.href}
                                        prefetch
                                        onClick={() => setMoreOpen(false)}
                                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-colors ${
                                            isGroupActive(pathname, item)
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
                        <p className="text-sm font-bold text-[#052d4a] flex items-center gap-1.5 mb-3 px-1">
                            <Lock size={13} className="text-slate-400" /> Internal
                        </p>
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
                    style={{ ...tabStyle(moreOpen || internalActive || moreToolsActive), background: 'none', border: 'none', cursor: 'pointer' }}
                >
                    <MoreHorizontal size={22} strokeWidth={moreOpen || internalActive || moreToolsActive ? 2.4 : 2} />
                    <span>More</span>
                </button>
            </nav>

            {/* Page Content */}
            {/* Internal screens get the navy theme (globals.css .theme-internal). */}
            <div
                className={`md:pl-[var(--sidebar-w)] transition-[padding] duration-200 ${internalActive ? 'theme-internal' : ''}`}
                style={{ ['--sidebar-w' as string]: `${rail ? RAIL_WIDTH : SIDEBAR_WIDTH}px` }}
            >
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
