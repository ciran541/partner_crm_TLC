import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireInsuranceUser } from '@/lib/auth/requireInsuranceUser'
import { rateLimitUser } from '@/lib/rateLimit'
import { generatePdf } from '@/lib/email/generatePdf'
import { commissionWithFee } from '@/lib/insurance/commission'
import { todaySgt } from '@/lib/insurance/promotions'
import { isPeriod, periodRange, statementHtml } from '@/lib/insurance/earningsStatement'
import type { CaseListRow } from '@/lib/insurance/caseQuery'

export const maxDuration = 60

/**
 * GET /api/insurance/earnings/statement?period=YYYY-MM|YYYY[&agent=uuid]: PDF.
 * An agent gets their own; an admin must name the agent.
 */
export async function GET(request: Request) {
    const auth = await requireInsuranceUser()
    if (!auth.authorized) return auth.response

    const sp = new URL(request.url).searchParams
    const period = sp.get('period') ?? ''
    if (!isPeriod(period)) return NextResponse.json({ error: 'Choose a month or a year.' }, { status: 400 })
    const agent = auth.isAdmin ? sp.get('agent') : auth.userId
    if (!agent) return NextResponse.json({ error: 'Choose an agent.' }, { status: 400 })

    // Each PDF launches a browser.
    const limited = await rateLimitUser(auth.userId, 'earnings-statement', 'heavy')
    if (limited) return limited

    const db = createAdminClient()
    const { from, to } = periodRange(period)
    const [profile, closed, paid] = await Promise.all([
        db.from('profiles').select('name, full_name').eq('id', agent).single(),
        db.rpc('search_cases', { p_viewer_id: agent, p_stage: 'Closed Won', p_closed_month: period, p_limit: 2000 }),
        db.from('commission_payouts')
            .select('amount, paid_on, reference, reverses, cases!inner(client_name, created_by)')
            .eq('cases.created_by', agent).gte('paid_on', from).lte('paid_on', to)
            .order('paid_on').order('created_at').limit(1000),
    ])
    if (profile.error || closed.error || paid.error) {
        console.error('[earnings statement]', profile.error ?? closed.error ?? paid.error)
        return NextResponse.json({ error: 'Could not prepare the statement.' }, { status: 500 })
    }

    const rows = ((closed.data as { rows?: CaseListRow[] } | null)?.rows ?? [])
        .sort((a, b) => (a.closed_on ?? '').localeCompare(b.closed_on ?? ''))
    const html = statementHtml({
        agentName: profile.data.full_name || profile.data.name || 'Agent',
        period,
        preparedOn: todaySgt(),
        cases: rows.map(c => {
            const m = commissionWithFee(c.loan_value ?? 0, c.correction_fee)
            return {
                client: c.client_name || 'Unnamed', caseType: c.case_type, closedOn: c.closed_on ?? '',
                loan: c.loan_value ?? 0, gross: m.gross, fee: m.correctionFee, share: m.agent,
                paid: Number(c.commission_paid_total ?? 0),
            }
        }),
        payouts: (paid.data ?? []).map(p => {
            const c = p.cases as unknown as { client_name: string | null }
            return { client: c?.client_name || 'Unnamed', paidOn: p.paid_on, amount: Number(p.amount), reference: p.reference, reversal: !!p.reverses }
        }),
    })

    try {
        const pdf = await generatePdf(html)
        return new NextResponse(new Uint8Array(pdf), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="Earnings-${period}.pdf"`,
                'Cache-Control': 'no-store',
            },
        })
    } catch (e) {
        console.error('[earnings statement pdf]', e)
        return NextResponse.json({ error: 'Could not prepare the PDF. Try again.' }, { status: 500 })
    }
}
