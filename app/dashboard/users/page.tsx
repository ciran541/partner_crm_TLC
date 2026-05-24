import { redirect } from 'next/navigation'

/**
 * Legacy redirect — keeps /dashboard/users bookmarks working.
 * Admin users management has moved to /admin/users.
 */
export default function LegacyUsersRedirect() {
    redirect('/admin/users')
}
