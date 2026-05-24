import { redirect } from 'next/navigation'

export default function LegacyCasesRedirect() {
    redirect('/insurance/dashboard/cases')
}
