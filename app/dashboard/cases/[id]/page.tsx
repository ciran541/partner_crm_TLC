import { redirect } from 'next/navigation'

export default function LegacyCaseDetailRedirect({ params }: { params: { id: string } }) {
    redirect(`/insurance/dashboard/cases/${params.id}`)
}
