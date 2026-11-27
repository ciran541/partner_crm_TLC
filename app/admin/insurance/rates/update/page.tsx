import { redirect } from 'next/navigation'

// Old address of the rates desk; Admin → Rates is the desk now.
export default function RateUpdatePage() {
    redirect('/admin/insurance/rates')
}
