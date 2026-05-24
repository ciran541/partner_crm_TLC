import { NextResponse } from 'next/server'
import { sendOpportunityAlert } from '@/lib/email/sendOpportunityAlert'

// Dev-only endpoint — blocked in production
export async function GET(request: Request) {
    if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not available' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const to = searchParams.get('to')

    if (!to) {
        return NextResponse.json({ error: 'Pass ?to=your@email.com' }, { status: 400 })
    }

    try {
        await sendOpportunityAlert({
            agentEmail: to,
            agentName: 'David Lim',
            clientName: 'Jonathan Tan Wei Ming',
            caseId: 'test-case-id-123',
            projectedAgentIncome: 1125,
            lockinConfirmedDate: '2027-02-15',
        })

        return NextResponse.json({
            ok: true,
            message: `Test email sent to ${to}`,
            data: {
                agent: 'David Lim',
                client: 'Jonathan Tan Wei Ming',
                projectedIncome: 'S$1,125',
                lockinDate: '15 February 2027',
            },
        })
    } catch (err) {
        return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
}
