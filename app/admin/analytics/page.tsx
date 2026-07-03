import { redirect } from 'next/navigation'

// Superseded by the insurance ops console. Kept as a redirect so old links/bookmarks
// resolve to the single source of truth.
export default function AdminAnalyticsRedirect() {
    redirect('/admin/insurance/analytics')
}
