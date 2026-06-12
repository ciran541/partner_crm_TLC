'use client'

import { Receipt } from 'lucide-react'
import ComingSoon from '@/components/insurance/ComingSoon'

export default function ValuationFeesPage() {
    return (
        <ComingSoon
            icon={Receipt}
            title="Valuation Fees"
            description="Look up valuation and related fees for your client."
        />
    )
}
