import { redirect } from 'next/navigation'

/** Replaced by the TLC Dashboard. */
export default function PremiumAnalyticsRedirect() {
    redirect('/admin/finance')
}
