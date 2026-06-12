'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Case creation now starts from the Mortgage Planner (the client-safe landing
// screen), which opens the workflow directly and collects client details later.
// Any old links to /cases/new bounce there.
export default function NewCaseRedirect() {
    const router = useRouter()
    useEffect(() => {
        router.replace('/insurance/dashboard')
    }, [router])
    return null
}
