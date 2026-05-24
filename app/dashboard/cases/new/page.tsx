import { redirect } from 'next/navigation'

export default function LegacyNewCaseRedirect() {
    redirect('/insurance/dashboard/cases/new')
}
