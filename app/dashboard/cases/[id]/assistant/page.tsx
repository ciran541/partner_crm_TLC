import { redirect } from 'next/navigation'

export default function LegacyAssistantRedirect({ params }: { params: { id: string } }) {
    redirect(`/insurance/dashboard/cases/${params.id}/assistant`)
}
