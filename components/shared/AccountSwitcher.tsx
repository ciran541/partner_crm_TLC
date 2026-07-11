'use client'

import { useEffect, useState } from 'react'
import { ChevronsUpDown, Check, LogOut, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import {
    getLinkedAccounts,
    updateLinkedAccountTokens,
    switchToAccount,
    type LinkedAccount,
} from '@/lib/auth/accountSwitcher'
import { getSafeRoute } from '@/lib/permissions'

interface AccountSwitcherProps {
    email: string | null
    displayName: string | null
    roleLabel: string
    avatarColor: string
    onSignOut: () => void
    addAccountLinks: { label: string; href: string }[]
    // Admin footers pass true: only the boss ever sees the admin layout, so the
    // "add another account" menu can stay visible even before a second account
    // is cached (otherwise there's no way to discover it on a fresh device/PWA
    // install — the menu that reveals it is the thing being gated). Regular
    // agent footers leave this false so the feature stays invisible to them.
    alwaysShowMenu?: boolean
}

export default function AccountSwitcher({
    email,
    displayName,
    roleLabel,
    avatarColor,
    onSignOut,
    addAccountLinks,
    alwaysShowMenu = false,
}: AccountSwitcherProps) {
    // Starts empty on both server and client — reading localStorage during the
    // initial render (e.g. via a lazy useState initializer) would make the
    // client's first paint diverge from the server-rendered HTML and trigger a
    // hydration mismatch. The real list loads client-side, after mount, below.
    const [open, setOpen] = useState(false)
    const [accounts, setAccounts] = useState<LinkedAccount[]>([])
    const [currentUserId, setCurrentUserId] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let active = true
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!active) return
            setCurrentUserId(user?.id ?? null)
            setAccounts(getLinkedAccounts())
        })

        // Keeps whichever cached account is currently active up to date as its
        // refresh token rotates, so switching back to it later still works.
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.user) return
            setCurrentUserId(session.user.id)
            updateLinkedAccountTokens(session.user.id, session.access_token, session.refresh_token)
            setAccounts(getLinkedAccounts())
        })
        return () => {
            active = false
            sub.subscription.unsubscribe()
        }
    }, [])

    const initials = (displayName || email || 'U')[0].toUpperCase()
    const others = accounts.filter(a => a.userId !== currentUserId)

    // Nothing to switch to — render the plain footer, same as before this feature existed.
    if (others.length === 0 && !alwaysShowMenu) {
        return (
            <div className="flex items-center gap-3">
                <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ background: avatarColor }}
                >
                    {initials}
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                        {displayName || email?.split('@')[0] || ' '}
                    </p>
                    <p className="text-[11px] text-slate-400">{roleLabel}</p>
                </div>
            </div>
        )
    }

    const handleSwitch = async (account: LinkedAccount) => {
        setBusy(true)
        setError(null)
        try {
            await switchToAccount(account)
            window.location.assign(getSafeRoute(account.role, account.appType))
        } catch {
            setError(`Couldn't switch to ${account.email} — sign in again to refresh it.`)
            setAccounts(getLinkedAccounts())
            setBusy(false)
        }
    }

    return (
        <div className="relative">
            {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center gap-3 text-left"
            >
                <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ background: avatarColor }}
                >
                    {initials}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">
                        {displayName || email?.split('@')[0] || ' '}
                    </p>
                    <p className="text-[11px] text-slate-400">{roleLabel}</p>
                </div>
                <ChevronsUpDown size={14} className="text-slate-400 shrink-0" />
            </button>

            {open && (
                <div className="absolute bottom-full left-0 mb-2 w-full min-w-[240px] rounded-xl bg-white shadow-2xl border border-slate-200 py-1.5 z-50 overflow-hidden">
                    {error && (
                        <p className="px-3 py-2 text-[11px] text-red-600 border-b border-slate-100">{error}</p>
                    )}
                    <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Switch account
                    </p>
                    {accounts.map(account => {
                        const isCurrent = account.userId === currentUserId
                        return (
                            <button
                                key={account.userId}
                                type="button"
                                disabled={isCurrent || busy}
                                onClick={() => handleSwitch(account)}
                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                                    isCurrent ? 'cursor-default' : 'hover:bg-slate-50 cursor-pointer'
                                }`}
                            >
                                <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                                    style={{ background: avatarColor }}
                                >
                                    {(account.name || account.email)[0].toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-slate-800 font-medium truncate">{account.name || account.email}</p>
                                    <p className="text-[11px] text-slate-400 truncate">{account.email}</p>
                                </div>
                                {isCurrent && <Check size={14} className="text-emerald-500 shrink-0" />}
                            </button>
                        )
                    })}

                    <div className="border-t border-slate-100 mt-1 pt-1">
                        {addAccountLinks.map(link => (
                            <a
                                key={link.href}
                                href={link.href}
                                className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                            >
                                <UserPlus size={14} className="text-slate-400" />
                                {link.label}
                            </a>
                        ))}
                        <button
                            type="button"
                            onClick={onSignOut}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                            <LogOut size={14} />
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
