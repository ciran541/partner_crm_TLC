import { NextResponse } from 'next/server'
import { sendFollowUpReminder } from '@/lib/email/sendFollowUpReminder'

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
        await sendFollowUpReminder({
            agentEmail: to,
            agentName: 'David Lim',
            clientName: 'Jonathan Tan Wei Ming',
            clientMobile: '+65 9123 4567',
            caseId: 'test-case-id-456',
            bankName: 'DBS',
            projectedAgentIncome: 1125,
            lockInPeriod: 2,
        })

        return NextResponse.json({
            ok: true,
            message: `Follow-up reminder email sent to ${to}`,
            dummy_data: {
                agent: 'David Lim',
                client: 'Jonathan Tan Wei Ming',
                mobile: '+65 9123 4567',
                bank: 'DBS',
                lockIn: '2 years',
                projectedIncome: 'S$1,125',
            },
        })
    } catch (err) {
        return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
    }
}
