'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// Sales Assistant has been replaced by the Workflow Engine.
// Redirect any bookmarked / old links to the new workflow page.
export default function AssistantRedirect() {
    const params = useParams()
    const router = useRouter()

    useEffect(() => {
        router.replace(`/insurance/dashboard/cases/${params?.id}/workflow`)
    }, [params?.id, router])

    return null
}
