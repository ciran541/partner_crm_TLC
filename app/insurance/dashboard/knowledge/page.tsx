'use client'

import KnowledgeAsk from '@/components/insurance/knowledge/KnowledgeAsk'
import { BookOpen } from 'lucide-react'

// Agent-facing: search / ask only (never an unfiltered list). Authoring lives in
// the admin console (/admin/insurance/knowledge).
export default function KnowledgePage() {
    return (
        <div className="max-w-3xl mx-auto space-y-5">
            <div>
                <h1 className="ios-page-title flex items-center gap-2">
                    <BookOpen size={24} className="text-[#03a9e7]" /> Knowledge
                </h1>
            </div>
            <KnowledgeAsk autoFocus />
        </div>
    )
}
