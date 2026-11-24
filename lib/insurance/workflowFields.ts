import type { Case } from '@/lib/types'
import type { RefinancingWorkflow, PurchaseWorkflow, DecoupleWorkflow, EquityLoanWorkflow } from '@/lib/types/workflow'
import { computePurchase, inputsFromWorkflow } from '@/lib/insurance/purchaseCalc'

export type AnyWorkflow = RefinancingWorkflow | PurchaseWorkflow | DecoupleWorkflow | EquityLoanWorkflow

/**
 * Case columns that follow the workflow answers, so the Overview stays in sync.
 * Used by the agent's autosave and the admin's workflow editor.
 */
export function workflowCaseFields(caseType: string | undefined, wf: AnyWorkflow): Partial<Case> {
    const updates: Partial<Case> = {}

    if (caseType === 'Purchase') {
        const p = wf as PurchaseWorkflow
        if (p.property_type) {
            const map: Record<string, string> = {
                resale_condo: 'Private Condo', new_launch_condo: 'Private Condo', resale_landed: 'Landed',
                ec_new_launch: 'EC (Executive Condo)', resale_hdb: 'HDB', bto: 'HDB',
            }
            updates.property_type = map[p.property_type] ?? p.property_type
        }
        if (p.property_price) updates.property_price = p.property_price
        // Sync overview "Loan Amount" with the computed final loan of the headline option.
        const loan = computePurchase(inputsFromWorkflow(p)).options[0]?.finalLoan
        if (loan && loan > 0) updates.loan_size = Math.floor(loan)
        return updates
    }

    if (caseType === 'Decouple') {
        const d = wf as DecoupleWorkflow
        if (d.current_bank) updates.current_bank = d.current_bank
        if (d.property_valuation) updates.property_price = d.property_valuation
        const totalOutstanding = (d.outstanding_home_loan ?? 0) + (d.outstanding_equity_loan ?? 0) + (d.outstanding_undisbursed ?? 0)
        if (totalOutstanding > 0) updates.existing_loan_amount = totalOutstanding
        if (d.property_type) {
            const map: Record<string, string> = {
                completed_condo: 'Private Condo', completed_ec: 'Private Condo', incompleted_condo: 'Private Condo', landed: 'Landed',
            }
            updates.property_type = map[d.property_type] ?? d.property_type
        }
        return updates
    }

    if (caseType === 'Equity Loan') {
        const e = wf as EquityLoanWorkflow
        if (e.current_bank) updates.current_bank = e.current_bank
        if (e.market_price) updates.property_price = e.market_price
        const totalOutstanding = (e.outstanding_disbursed ?? 0) + (e.outstanding_equity_loan ?? 0)
        if (totalOutstanding > 0) updates.existing_loan_amount = totalOutstanding
        if (e.equity_loan_amount) updates.loan_size = e.equity_loan_amount
        if (e.property_type) {
            const map: Record<string, string> = {
                landed: 'Landed', completed_condo: 'Private Condo', completed_ec_mop: 'Private Condo',
            }
            updates.property_type = map[e.property_type] ?? e.property_type
        }
        return updates
    }

    const r = wf as RefinancingWorkflow

    if (r.current_bank) updates.current_bank = r.current_bank
    const totalOutstanding = (r.outstanding_disbursed ?? 0) + (r.outstanding_undisbursed ?? 0)
    if (totalOutstanding > 0) updates.existing_loan_amount = totalOutstanding
    if (r.lockin_end_date) updates.lock_in_end_date = r.lockin_end_date
    if (r.market_price) updates.property_price = r.market_price
    if (r.property_type) {
        const map: Record<string, string> = {
            hdb: 'HDB', completed_condo_ec: 'Private Condo', incompleted_condo_ec: 'Private Condo', landed: 'Landed',
        }
        updates.property_type = map[r.property_type] ?? r.property_type
    }

    return updates
}
