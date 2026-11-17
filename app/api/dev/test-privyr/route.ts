import { NextResponse } from 'next/server'
import { sendToPrivyr } from '@/lib/privyr/sendToPrivyr'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'

/**
 * GET /api/dev/test-privyr
 *
 * Instantly fires a test lead to the configured Privyr webhook.
 * Use this to verify the webhook URL, payload shape, and that
 * the "refinancing_due" note routes to the correct WA template.
 *
 * Protected — must be a logged-in insurance user (admin in practice).
 * Remove or gate behind requireAdminUser() before going to production
 * if you don't want any agent to be able to trigger this.
 *
 * Optional query params to customise the test payload:
 *   ?name=John+Tan          — override test client name
 *   ?phone=+6591234567      — override test phone
 *   ?email=test@example.com — override test email
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const { searchParams } = new URL(request.url)

    const name  = searchParams.get('name')  ?? 'Test Client (TLC CRM)'
    const phone = searchParams.get('phone') ?? '+6500000000'
    const email = searchParams.get('email') ?? null

    const today = new Date().toISOString().split('T')[0]

    const result = await sendToPrivyr({
        name,
        phone,
        ...(email ? { email } : {}),
        otherFields: {
            'Source':               'TLC CRM — TEST',
            'Case Type':            'Refinancing',
            'Current Bank':         'DBS',
            'Lock-In Period (Years)': 2,
            'Outstanding Loan (SGD)': 500000,
            'Follow-Up Date':       today,
            'Case URL':             `${process.env.NEXT_PUBLIC_APP_URL}/insurance/dashboard/cases/TEST-CASE-ID`,
        },
    })

    if (!result.ok) {
        return NextResponse.json(
            { ok: false, error: result.error },
            { status: 502 }
        )
    }

    return NextResponse.json({
        ok: true,
        lead_id: result.leadId,
        sentAt: new Date().toISOString(),
        payload: {
            name,
            phone,
            email,
            notes: 'refinancing_due',
            followUpDate: today,
        },
        message: 'Lead pushed to Privyr ✓ — check your Privyr account for the incoming lead.',
    })
}
