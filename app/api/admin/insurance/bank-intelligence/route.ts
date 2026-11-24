import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import {
    getAllReports, createManualReport, setPublished, setHidden, updateSummary, deleteReport, extractSummary,
} from '@/lib/insurance/bankIntelligence'
import type { BankIntelligenceReportInput } from '@/lib/types/bankIntelligence'

// Admin QA for Banks' Insights. Guarded by requireAdminUser().
//   GET                                  → list all reports (incl. unpublished/hidden)
//   POST   { input }                     → one-off manual addition (QA use only — not the discovery path)
//   PATCH  { id, isPublished }           → publish/unpublish (the review gate)
//   PATCH  { id, hidden }                → hide/unhide
//   PATCH  { id, summary }               → edit the AI-extracted summary before publishing
//   PATCH  { id, reExtract: true }       → re-run Claude extraction (e.g. after a prior failure)
//   DELETE ?id=                          → delete

export async function GET() {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const data = await getAllReports()
    return NextResponse.json({ data })
}

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const input = body?.input as BankIntelligenceReportInput | undefined
    if (!input?.bank || !input?.bank_key || !input?.title || !input?.report_period || !input?.pdf_url) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const data = await createManualReport(input)
    if (!data) return NextResponse.json({ error: 'Failed to create report (duplicate PDF URL?)' }, { status: 500 })
    return NextResponse.json({ data })
}

export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const body = await request.json().catch(() => ({}))
    const { id, isPublished, hidden, summary, reExtract } = body as {
        id?: string; isPublished?: boolean; hidden?: boolean; summary?: string; reExtract?: boolean
    }
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    if (reExtract) {
        const ok = await extractSummary(id)
        if (!ok) return NextResponse.json({ error: 'Extraction failed' }, { status: 502 })
        return NextResponse.json({ success: true })
    }

    let ok = true
    if (typeof isPublished === 'boolean') ok = ok && await setPublished(id, isPublished)
    if (typeof hidden === 'boolean') ok = ok && await setHidden(id, hidden)
    if (typeof summary === 'string') ok = ok && await updateSummary(id, summary)
    if (typeof isPublished !== 'boolean' && typeof hidden !== 'boolean' && typeof summary !== 'string') {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    if (!ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const ok = await deleteReport(id)
    if (!ok) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
    return NextResponse.json({ success: true })
}
