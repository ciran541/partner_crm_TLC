'use client'

import NewsAdminView from '@/components/insurance/news/NewsAdminView'

// Admin QA console for Mortgage News. Ingestion is fully automated (daily cron);
// this screen is for hiding bad articles, deleting, and one-off manual QA adds.
export default function AdminInsuranceNewsPage() {
    return <NewsAdminView />
}
