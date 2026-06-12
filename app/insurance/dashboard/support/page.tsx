'use client'

import { LifeBuoy } from 'lucide-react'
import ComingSoon from '@/components/insurance/ComingSoon'

export default function SupportPage() {
    return (
        <ComingSoon
            icon={LifeBuoy}
            title="Support"
            description="Get help and raise issues with the team."
        />
    )
}
