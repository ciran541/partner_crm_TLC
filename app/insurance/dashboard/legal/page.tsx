'use client'

import { Scale } from 'lucide-react'
import ComingSoon from '@/components/insurance/ComingSoon'

export default function LegalPage() {
    return (
        <ComingSoon
            icon={Scale}
            title="Legal"
            description="Conveyancing and legal fee references for your client."
        />
    )
}
