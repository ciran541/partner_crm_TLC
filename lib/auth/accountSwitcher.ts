import { supabase } from '@/lib/supabaseClient'
import type { UserRole, AppType } from '@/lib/types/shared'

/**
 * Lets one person (currently: the boss, who holds both an admin and an agent
 * account) hop between logged-in accounts on one device without a full
 * logout/login — like Google's account switcher. Each account's session is
 * cached in localStorage on login and kept fresh via onAuthStateChange, so
 * switching is just handing Supabase the cached refresh token instead of
 * re-authenticating.
 *
 * This intentionally caches on every login, not just for one person — but the
 * switcher UI (AccountSwitcher.tsx) only renders once 2+ accounts are cached,
 * so a normal single-account agent never sees it.
 */

const STORAGE_KEY = 'tlc_linked_accounts'

export interface LinkedAccount {
    userId: string
    email: string
    name: string | null
    role: UserRole
    appType: AppType
    accessToken: string
    refreshToken: string
    savedAt: number
}

function readAll(): Record<string, LinkedAccount> {
    if (typeof window === 'undefined') return {}
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : {}
    } catch {
        return {}
    }
}

function writeAll(accounts: Record<string, LinkedAccount>) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts))
}

export function getLinkedAccounts(): LinkedAccount[] {
    return Object.values(readAll()).sort((a, b) => b.savedAt - a.savedAt)
}

export function saveLinkedAccount(account: Omit<LinkedAccount, 'savedAt'>) {
    const all = readAll()
    all[account.userId] = { ...account, savedAt: Date.now() }
    writeAll(all)
}

/** Called on every TOKEN_REFRESHED so a cached account never goes stale while it's the active one. */
export function updateLinkedAccountTokens(userId: string, accessToken: string, refreshToken: string) {
    const all = readAll()
    if (!all[userId]) return
    all[userId] = { ...all[userId], accessToken, refreshToken }
    writeAll(all)
}

export function removeLinkedAccount(userId: string) {
    const all = readAll()
    delete all[userId]
    writeAll(all)
}

/** Swaps the active Supabase session to a cached account. Throws (and evicts the cache entry) if its refresh token has been revoked/rotated out. */
export async function switchToAccount(account: LinkedAccount) {
    const { error } = await supabase.auth.setSession({
        access_token: account.accessToken,
        refresh_token: account.refreshToken,
    })
    if (error) {
        removeLinkedAccount(account.userId)
        throw error
    }
}
