import { redirect } from 'next/navigation'

/**
 * Legacy redirect — keeps /dashboard/analytics bookmarks working.
 * Analytics has moved to /admin/analytics.
 */
export default function LegacyAnalyticsRedirect() {
    redirect('/admin/analytics')
}
