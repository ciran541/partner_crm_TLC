import { NextResponse } from 'next/server'
import { getServerUser } from '@/lib/auth/getUser'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessInsurance } from '@/lib/permissions'

import { computeRefi, inputsFromWorkflow as refiInputsFromWorkflow, refiPropertyMeta } from '@/lib/insurance/refiCalc'
import { buildRefiRemarks } from '@/lib/insurance/refiRemarks'
import { buildRefiPresentationHtml } from '@/lib/insurance/refiPresentation'
import { getRefinancingWorkflow } from '@/lib/types/workflow'

import { computePurchase, inputsFromWorkflow as purchaseInputsFromWorkflow } from '@/lib/insurance/purchaseCalc'
import { buildRemarks as buildPurchaseRemarks } from '@/lib/insurance/purchaseRemarks'
import { buildPresentationHtml as buildPurchasePresentationHtml } from '@/lib/insurance/purchasePresentation'
import { getPurchaseWorkflow } from '@/lib/types/workflow'

import { computeDecouple, inputsFromDecoupleWorkflow } from '@/lib/insurance/decoupleCalc'
import { buildDecouplePresentationHtml } from '@/lib/insurance/decouplePresentation'
import { getDecoupleWorkflow, getEquityLoanWorkflow } from '@/lib/types/workflow'

import { buildEquityLoanPresentationHtml } from '@/lib/insurance/equityLoanReport'

import { generatePdf } from '@/lib/email/generatePdf'
import { sendWorkflowReport } from '@/lib/email/sendWorkflowReport'
import { getCurrentSora } from '@/lib/insurance/sora'

// POST /api/insurance/cases/[id]/send-report
// Generates a PDF from the case's workflow data and emails it to the client.
export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
) {
    const { user, profile } = await getServerUser()
    if (!user || !profile) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!canAccessInsurance(profile.role, profile.app_type)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id: caseId } = await params
    const admin = createAdminClient()

    // Fetch case (agent can only access their own cases; admins see all).
    // Note: `profiles` has no email column — the agent's email comes from the auth
    // user (user.email), so we only join the agent's name here.
    const { data: row, error } = await admin
        .from('cases')
        .select('id, case_type, client_name, client_email, workflow_data, profiles(name)')
        .eq('id', caseId)
        .maybeSingle()

    if (error) {
        console.error('[send-report] case query failed:', error.message)
        return NextResponse.json({ error: `Failed to load case: ${error.message}` }, { status: 500 })
    }
    if (!row) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }
    if (!row.client_email) {
        return NextResponse.json({ error: 'No client email on this case. Add it in the case details first.' }, { status: 422 })
    }

    const agentProfile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    const agentName: string = profile.name ?? agentProfile?.name ?? ''
    const agentEmail: string | undefined = user.email ?? undefined

    let html: string
    const caseType = row.case_type as string

    if (caseType === 'Refinancing') {
        const wf = getRefinancingWorkflow(row.workflow_data)
        const computation = computeRefi(refiInputsFromWorkflow(wf))
        const meta = refiPropertyMeta(wf.property_type)
        const remarks = buildRefiRemarks({
            propertyType: wf.property_type,
            isPrivate: meta?.isPrivate,
            buc: meta?.buc,
            totalOutstanding: computation.totalOutstanding,
            undisbursed: wf.outstanding_undisbursed,
            subsidyClawback: computation.subsidyClawback,
            smallLoanNoSubsidy: computation.smallLoanNoSubsidy,
            considerations: wf.considerations,
            cost: computation.cost,
            tenureError: computation.tenure?.error ?? null,
        })
        const totalOutstanding = (wf.outstanding_disbursed ?? 0) + (wf.outstanding_undisbursed ?? 0)
        html = buildRefiPresentationHtml({
            clientName: row.client_name ?? undefined,
            advisorName: agentName || undefined,
            propertyLabel: meta?.label ?? 'Property',
            currentBank: wf.current_bank,
            currentRatePct: wf.current_rate,
            totalOutstanding,
            computation,
            remarks,
            selectedPackage: wf.selected_package_snapshot
                ? (wf.selected_package_snapshot as Parameters<typeof buildRefiPresentationHtml>[0]['selectedPackage'])
                : null,
            sora: await getCurrentSora(),
        })

    } else if (caseType === 'Purchase') {
        const wf = getPurchaseWorkflow(row.workflow_data)
        const computation = computePurchase(purchaseInputsFromWorkflow(wf))
        const remarks = buildPurchaseRemarks({
            propertyType: wf.property_type,
            otpObtained: wf.otp_obtained,
            sellingExisting: wf.selling_existing,
            sellAtTop: wf.sell_at_top,
            residency: computation.absdResidency,
            outstanding: wf.outstanding_housing_loans,
            bsd: computation.bsd,
            absd: computation.absd,
        })
        const propertyMeta = computation.options[0]
        const price = wf.property_price ?? 0
        const PURCHASE_PROPERTY_LABELS: Record<string, string> = {
            resale_condo: 'Resale Condo', new_launch_condo: 'New Launch Condo', resale_landed: 'Resale Landed',
            ec_new_launch: 'EC (New Launch)', resale_hdb: 'Resale HDB', bto: 'BTO',
        }
        html = buildPurchasePresentationHtml({
            clientName: row.client_name ?? undefined,
            advisorName: agentName || undefined,
            propertyLabel: PURCHASE_PROPERTY_LABELS[wf.property_type ?? ''] ?? 'Property',
            price,
            referenceRate: wf.reference_rate,
            computation,
            remarks,
            selectedPackage: wf.selected_package_snapshot
                ? (wf.selected_package_snapshot as Parameters<typeof buildPurchasePresentationHtml>[0]['selectedPackage'])
                : null,
            sora: await getCurrentSora(),
        })

    } else if (caseType === 'Decouple') {
        const wf = getDecoupleWorkflow(row.workflow_data)
        const computation = computeDecouple(inputsFromDecoupleWorkflow(wf))
        const DECOUPLE_PROPERTY_LABELS: Record<string, string> = {
            completed_condo: 'Completed Condo', completed_ec: 'Completed EC',
            incompleted_condo: 'Incompleted Condo', landed: 'Landed',
        }
        html = buildDecouplePresentationHtml({
            clientName: row.client_name ?? undefined,
            advisorName: agentName || undefined,
            propertyLabel: DECOUPLE_PROPERTY_LABELS[wf.property_type ?? ''] ?? 'Property',
            propertyValuation: wf.property_valuation ?? 0,
            buyerShare: wf.buyer_share ?? 50,
            computation,
            workflow: wf,
        })

    } else if (caseType === 'Equity Loan') {
        const wf = getEquityLoanWorkflow(row.workflow_data)
        html = buildEquityLoanPresentationHtml({
            clientName: row.client_name ?? undefined,
            advisorName: agentName || undefined,
            workflow: wf,
            sora: await getCurrentSora(),
        })

    } else {
        return NextResponse.json({ error: `Report not available for case type: ${caseType}` }, { status: 422 })
    }

    try {
        const pdfBuffer = await generatePdf(html)

        await sendWorkflowReport({
            clientEmail: row.client_email,
            clientName: row.client_name ?? undefined,
            agentEmail,
            agentName: agentName || undefined,
            caseType: caseType as 'Refinancing' | 'Purchase' | 'Decouple' | 'Equity Loan',
            pdfBuffer,
        })
    } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to generate or send the report'
        console.error('[send-report] failed:', message)
        return NextResponse.json({ error: message }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
}
