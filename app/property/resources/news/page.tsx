'use client'

import NewsFeed from '@/components/insurance/news/NewsFeed'

// Premium-tier feature — property page for app/api/insurance/resources/news
// (already permits property agents server-side). Same shared feed as the
// insurance Resources page, in the property app's green accent.
export default function PropertyNewsPage() {
    return <NewsFeed accentColor="#059669" />
}
