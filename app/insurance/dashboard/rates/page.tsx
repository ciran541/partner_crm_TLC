'use client'

import RatesView from '@/components/insurance/rates/RatesView'

// Agent-facing: browse + filter published packages only. Authoring lives in the
// admin console (/admin/insurance/rates).
export default function RatesPage() {
    return <RatesView forceReadOnly />
}
