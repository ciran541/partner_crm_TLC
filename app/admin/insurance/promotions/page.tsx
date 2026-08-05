'use client'

import PromotionsAdminView from '@/components/insurance/promotions/PromotionsAdminView'

// Admin console for time-boxed bank promotions. Unlike news or bank insights,
// there is no discovery cron here — promotions arrive as a message to a person,
// so this screen is the data-entry path: paste, review, publish.
export default function AdminInsurancePromotionsPage() {
    return <PromotionsAdminView />
}
