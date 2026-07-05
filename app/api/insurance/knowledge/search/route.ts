import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { canAccessInsurance } from '@/lib/permissions'
import { retrieveArticles } from '@/lib/insurance/retrieveKnowledge'

// GET /api/insurance/knowledge/search?q=<text>
// Agent-facing. REQUIRES a query — never returns an unfiltered list.
// Retrieval cascade (semantic → fulltext → substring) lives in
// lib/insurance/retrieveKnowledge.ts, shared with the /ask route.
export async function GET(request: Request) {
    const { user, profile } = await getServerUser()
    if (!user || !profile || !canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim() ?? ''

    // Enforce a real query — no empty search that would expose everything
    if (q.length < 2) {
        return NextResponse.json({ data: [] })
    }

    const { articles, mode } = await retrieveArticles(q, { matchThreshold: 0.4, matchCount: 8 })
    return NextResponse.json({ data: articles, mode })
}
