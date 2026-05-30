'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

// Workflow is now embedded inside the case detail page (Workflow tab).
// Redirect any bookmarked or old links back to the case with the workflow tab active.
export default function WorkflowRedirect() {
    const params = useParams()
    const router = useRouter()

    useEffect(() => {
        router.replace(`/insurance/dashboard/cases/${params?.id}?tab=workflow`)
    }, [params?.id, router])

    return null
}
