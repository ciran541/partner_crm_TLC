import { redirect } from 'next/navigation'

export default function LegacyRatesRedirect() {
    redirect('/insurance/dashboard/rates')
}
