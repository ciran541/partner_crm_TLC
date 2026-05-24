import { redirect } from 'next/navigation'

export default function LegacyLockInEndRedirect() {
    redirect('/insurance/dashboard/cases/lock-in-end')
}
