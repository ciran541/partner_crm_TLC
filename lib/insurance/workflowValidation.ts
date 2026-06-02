/**
 * Workflow verification loop.
 *
 * Each step is validated before it can be marked complete:
 * - errors:   blocking. Required data missing or logically invalid. Cannot complete.
 * - warnings: non-blocking but must be seen. Sanity issues the agent should
 *             consciously acknowledge ("Complete anyway") before proceeding.
 *
 * The whole point: a checklist that can't be lied to (easily). The math we already
 * compute is reused here to catch nonsense — a new rate that doesn't save money,
 * a TDSR breach, a client who may not even qualify.
 */

import { RefinancingWorkflow, RefinancingStepKey } from '@/lib/types/workflow'
import { computeRefiSavings, maxEligibleLoan, tdsrRatioForLoan, TDSR_LIMIT } from './loanCalc'

export interface StepValidation {
    errors: string[]
    warnings: string[]
}

const EMPTY: StepValidation = { errors: [], warnings: [] }

function firstYearRate(wf: RefinancingWorkflow): number | undefined {
    const rates = (wf.qualify?.year_rates ?? []).map(r => parseFloat(r)).filter(r => !isNaN(r))
    return rates.length ? rates[0] : undefined
}

export function validateRefinancingStep(step: RefinancingStepKey, wf: RefinancingWorkflow): StepValidation {
    switch (step) {
        case 'qualify':           return validateQualify(wf)
        case 'fact_find':         return validateFactFind(wf)
        case 'risk_suitability':  return validateRiskSuitability(wf)
        case 'research_proposal': return validateResearchProposal(wf)
        case 'present_proposal':  return validatePresentProposal(wf)
        case 'collect_documents': return validateCollectDocuments(wf)
        case 'submit_bank':       return validateSubmitBank(wf)
        case 'followup_approval': return validateFollowupApproval(wf)
        case 'letter_offer':      return validateLetterOffer(wf)
        case 'close_retention':   return validateCloseRetention(wf)
        default:                  return EMPTY
    }
}

// ── Step 1 ──
function validateQualify(wf: RefinancingWorkflow): StepValidation {
    const q = wf.qualify ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!q.lock_in_status) errors.push('Select the lock-in status.')
    if (q.lock_in_status === 'in_lock_in' && !q.lock_in_expiry) errors.push('Enter the lock-in expiry date.')
    if (!q.current_bank) errors.push('Select the current bank.')
    if (!q.outstanding_loan) errors.push('Enter the outstanding loan amount.')
    if (!(q.year_rates ?? []).some(r => r && !isNaN(parseFloat(r)))) errors.push('Enter at least the current interest rate (Year 1).')

    if (q.outstanding_loan && q.outstanding_loan < 50000) warnings.push(`Outstanding loan of $${q.outstanding_loan.toLocaleString()} looks unusually low — double-check the figure.`)
    if (q.outstanding_loan && q.outstanding_loan > 10000000) warnings.push(`Outstanding loan of $${q.outstanding_loan.toLocaleString()} looks unusually high — double-check the figure.`)
    if (!q.remaining_tenure) warnings.push('Remaining tenure not set — needed to calculate monthly payments and savings.')
    if (q.worth_exploring === false) warnings.push('You marked this as NOT worth pursuing — confirm before proceeding.')
    if (q.worth_exploring === undefined) warnings.push('You haven\'t confirmed whether refinancing is worth pursuing.')

    return { errors, warnings }
}

// ── Step 2 ──
function validateFactFind(wf: RefinancingWorkflow): StepValidation {
    const ff = wf.fact_find ?? {}
    const q = wf.qualify ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!ff.property_type) errors.push('Select the property type.')
    if (!ff.gross_monthly_income) errors.push('Enter the gross monthly income.')
    if (ff.subsidy_received === undefined) errors.push('Answer whether a subsidy was received from the current bank.')
    if (ff.subsidy_received) {
        if (!ff.clawback_amount) errors.push('Enter the remaining clawback amount.')
        if (!ff.clawback_end_date) errors.push('Enter the clawback end date.')
    }

    if (ff.gross_monthly_income && ff.gross_monthly_income < 1000) warnings.push(`Monthly income of $${ff.gross_monthly_income.toLocaleString()} looks unusually low — confirm it's gross monthly, not annual.`)
    if (!ff.property_valuation) warnings.push('Property valuation not entered — needed for the loan-to-value check.')
    if (ff.property_valuation && q.outstanding_loan && ff.property_valuation < q.outstanding_loan) {
        warnings.push(`Property valuation ($${ff.property_valuation.toLocaleString()}) is below the outstanding loan ($${q.outstanding_loan.toLocaleString()}) — the loan is underwater (LTV over 100%). Refinancing will be difficult.`)
    }

    return { errors, warnings }
}

// ── Step 3 ──
function validateRiskSuitability(wf: RefinancingWorkflow): StepValidation {
    const rs = wf.risk_suitability ?? {}
    const ff = wf.fact_find ?? {}
    const q = wf.qualify ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!rs.selling_plan) errors.push('Answer whether the client plans to sell.')
    if (!rs.rate_preference) errors.push('Capture the client\'s rate preference.')
    if (!rs.holding_period) errors.push('Capture the client\'s expected holding period.')

    // Recompute TDSR for a sanity warning
    const income = (ff.gross_monthly_income ?? 0) + (ff.co_borrower_income ?? 0)
    if (income > 0 && q.outstanding_loan && q.remaining_tenure) {
        const tdsr = tdsrRatioForLoan({
            loanAmount: q.outstanding_loan, tenureYears: q.remaining_tenure,
            grossMonthlyIncome: income, existingMonthlyDebts: ff.other_monthly_debts ?? 0,
        })
        if (tdsr > TDSR_LIMIT * 100) warnings.push(`TDSR is ${tdsr.toFixed(0)}% — over the ${TDSR_LIMIT * 100}% limit. The bank will likely reject at this loan/income.`)
        else if (tdsr > 45) warnings.push(`TDSR is ${tdsr.toFixed(0)}% — approaching the ${TDSR_LIMIT * 100}% limit. Limited headroom.`)
    }
    if (rs.selling_plan === 'yes') warnings.push('Client plans to sell — refinancing into a new lock-in may not be suitable.')
    if (rs.holding_period === 'short') warnings.push('Short holding period — avoid packages with long lock-ins.')

    return { errors, warnings }
}

// ── Step 4 ──
function validateResearchProposal(wf: RefinancingWorkflow): StepValidation {
    const rp = wf.research_proposal ?? {}
    const ff = wf.fact_find ?? {}
    const q = wf.qualify ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!rp.recommended_package) errors.push('Enter the recommended package.')
    if (!rp.new_rate) errors.push('Enter the new interest rate.')
    if (!rp.proposal_ready) errors.push('Confirm the proposal is ready to present (tick the box).')

    const currentRate = firstYearRate(wf)
    // Package judgment checks — verify the recommendation actually makes sense
    if (currentRate !== undefined && rp.new_rate !== undefined) {
        if (rp.new_rate >= currentRate) {
            warnings.push(`The new rate (${rp.new_rate}%) is not lower than the current rate (${currentRate}%) — this does not save on interest.`)
        }
        if (q.outstanding_loan && q.remaining_tenure) {
            const s = computeRefiSavings({
                outstandingLoan: q.outstanding_loan, remainingTenureYears: q.remaining_tenure,
                currentRatePct: currentRate, newRatePct: rp.new_rate, clawbackAmount: ff.clawback_amount,
            })
            if (s.monthlySaving <= 0) warnings.push('Monthly saving is zero or negative at this new rate.')
            else if (s.netSaving2yr <= 0) warnings.push(`After the clawback, the 2-year net saving is negative (${s.netSaving2yr < 0 ? '−' : ''}$${Math.abs(Math.round(s.netSaving2yr)).toLocaleString()}). Refinancing may not be worth it.`)
        }
    }

    // Eligibility check — does the client even qualify?
    const income = (ff.gross_monthly_income ?? 0) + (ff.co_borrower_income ?? 0)
    if (income > 0 && q.outstanding_loan && q.remaining_tenure) {
        const elig = maxEligibleLoan({
            grossMonthlyIncome: income, existingMonthlyDebts: ff.other_monthly_debts ?? 0,
            propertyType: ff.property_type, tenureYears: q.remaining_tenure,
        })
        if (elig < q.outstanding_loan) {
            warnings.push(`Income supports only ~$${Math.round(elig).toLocaleString()}, below the $${q.outstanding_loan.toLocaleString()} needed. Client may not qualify without a co-borrower or income top-up.`)
        }
    }

    return { errors, warnings }
}

// ── Step 5 ──
function validatePresentProposal(wf: RefinancingWorkflow): StepValidation {
    const pp = wf.present_proposal ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!pp.proposal_presented_date) errors.push('Enter the date the proposal was presented.')
    if (!pp.client_response) errors.push('Record the client\'s response.')

    if (pp.client_response === 'declined') warnings.push('Client declined — consider marking the case Closed Lost rather than continuing.')
    if (pp.client_response === 'needs_time' || pp.client_response === 'objection') {
        if (!pp.follow_up_date) warnings.push('Client needs time / has an objection but no follow-up date is set.')
    }
    if ((pp.client_response === 'committed') && !pp.verbal_commitment) warnings.push('Marked committed but the verbal-commitment box isn\'t ticked.')

    return { errors, warnings }
}

// ── Step 6 ──
function validateCollectDocuments(wf: RefinancingWorkflow): StepValidation {
    const cd = wf.collect_documents ?? {}
    const ff = wf.fact_find ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!cd.nric_ready) errors.push('NRIC not collected.')
    if (ff.is_self_employed) {
        if (!cd.noa_ready) errors.push('NOA (self-employed) not collected.')
    } else {
        if (!cd.payslips_ready) errors.push('Payslips not collected.')
    }
    if (!cd.cpf_contribution_ready) errors.push('CPF contribution history not collected.')
    if (!cd.loan_statement_ready) errors.push('Current loan statement not collected.')

    if (ff.subsidy_received && !cd.subsidy_letter_ready) warnings.push('Subsidy was received but the subsidy/clawback letter isn\'t collected.')
    if (!cd.property_valuation_ready) warnings.push('Property valuation not confirmed (the new bank usually orders this).')

    return { errors, warnings }
}

// ── Step 7 ──
function validateSubmitBank(wf: RefinancingWorkflow): StepValidation {
    const sb = wf.submit_bank ?? {}
    const errors: string[] = []
    if (!sb.submission_date) errors.push('Enter the submission date.')
    if (!sb.submitted_bank) errors.push('Select the bank submitted to.')
    if (!sb.reference_number) errors.push('Enter the bank reference number.')
    return { errors, warnings: [] }
}

// ── Step 8 ──
function validateFollowupApproval(wf: RefinancingWorkflow): StepValidation {
    const fa = wf.followup_approval ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!fa.approval_status) errors.push('Set the approval status.')
    if ((fa.approval_status === 'approved' || fa.approval_status === 'conditional') && !fa.approval_date) {
        errors.push('Enter the approval / decision date.')
    }
    if (fa.approval_status === 'rejected') warnings.push('Application was rejected — consider marking the case Closed Lost.')
    if (fa.approval_status === 'conditional' && !fa.bank_queries_resolved) warnings.push('Conditional approval — conditions are not yet marked resolved.')
    if (fa.approval_status === 'pending') warnings.push('Approval is still pending — confirm before completing this step.')

    return { errors, warnings }
}

// ── Step 9 ──
function validateLetterOffer(wf: RefinancingWorkflow): StepValidation {
    const lo = wf.letter_offer ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!lo.loo_reviewed_with_client) errors.push('Confirm you reviewed the Letter of Offer with the client.')
    if (!lo.client_accepted) errors.push('Confirm the client accepted the Letter of Offer.')

    if (!lo.lock_in_explained) warnings.push('Lock-in period not marked as explained to the client.')
    if (!lo.clawback_explained) warnings.push('New-bank clawback not marked as explained (if applicable).')

    return { errors, warnings }
}

// ── Step 10 ──
function validateCloseRetention(wf: RefinancingWorkflow): StepValidation {
    const cr = wf.close_retention ?? {}
    const errors: string[] = []
    const warnings: string[] = []

    if (!cr.final_package) errors.push('Enter the final package.')
    if (!cr.final_rate) errors.push('Enter the final interest rate.')
    if (!cr.retention_reminder_date) errors.push('Set the retention reminder date.')

    if (cr.retention_reminder_date && new Date(cr.retention_reminder_date).getTime() < Date.now()) {
        warnings.push('The retention reminder date is in the past.')
    }

    return { errors, warnings }
}
