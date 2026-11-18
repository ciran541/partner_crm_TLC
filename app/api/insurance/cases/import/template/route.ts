import { NextResponse } from 'next/server'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { buildStarterSheet } from '@/lib/insurance/sheetImport'

/**
 * GET /api/insurance/cases/import/template — a blank starter sheet for agents
 * with no client list yet. Optional: the upload accepts any layout, and this
 * sheet's headings simply map automatically.
 */
export async function GET() {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const file = await buildStarterSheet()
    return new NextResponse(new Uint8Array(file), {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="TLC-HUB-client-list.xlsx"',
            'Cache-Control': 'no-store',
        },
    })
}
