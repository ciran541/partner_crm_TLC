'use client'

import BankIntelligenceAdminView from '@/components/insurance/bank-intelligence/BankIntelligenceAdminView'

// Admin QA console for Banks' Insights. Discovery + extraction are fully
// automated (daily cron); this screen is for reviewing an AI summary before
// publishing, hiding/deleting, and re-running a failed extraction.
export default function AdminBankIntelligencePage() {
    return <BankIntelligenceAdminView />
}
