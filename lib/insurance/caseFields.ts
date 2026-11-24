import { stageLabel } from '@/lib/insurance/stages'
import { leadSourceLabel, isLeadSource } from '@/lib/insurance/leadSources'

/** Plain-English names for case columns in change history (admin edits, Audit Log). */
const LABELS: Record<string, string> = {
    client_name: 'Client name', client_mobile: 'Mobile', client_email: 'Email', lead_source: 'Lead source', lead_source_other: 'Lead source (other)',
    referred_bankers: 'Bankers', follow_up_date: 'Follow-up date', follow_up_remark: 'Follow-up remark', remarks: 'Remarks', case_type: 'Case type', stage: 'Stage',
    loan_size: 'Loan amount', property_type: 'Property type', property_price: 'Property price', property_address: 'Property address', current_bank: 'Current bank',
    existing_loan_amount: 'Existing loan', lock_in_end_date: 'Lock-in end', closed_package_details: 'Package', closed_interest_rate: 'Interest rate', closed_tenure: 'Tenure',
    subsidy_provided: 'Subsidy', clawback_end_date: 'Clawback end', 'closed_won_data.loans': 'Closing loans', 'closed_won_data.package': 'Closing package', 'closed_won_data.bank': 'Closing bank',
    'closed_won_data.lo_documents': 'Letter of Offer', 'closed_won_data.original_loan_total': 'Loan total', 'closed_won_data.combined_outstanding': 'Outstanding at lock-in end',
    'closed_won_data.property_address': 'Property address',
}

export function caseFieldLabel(key: string): string {
    if (LABELS[key]) return LABELS[key]
    const s = key.replace(/^(workflow_data|closed_won_data)\./, '').replace(/_/g, ' ')
    return s.charAt(0).toUpperCase() + s.slice(1)
}

export function caseFieldValue(v: unknown): string {
    if (v == null || v === '') return 'blank'
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'number') return v.toLocaleString('en-SG')
    if (typeof v === 'string') return isLeadSource(v) ? leadSourceLabel(v) : stageLabel(v)
    if (Array.isArray(v)) {
        if (!v.length) return 'none'
        return v.map(x => {
            if (x && typeof x === 'object') {
                const o = x as Record<string, unknown>
                if (o.kind && o.amount) return `${Number(o.amount).toLocaleString('en-SG')} over ${o.tenure} yrs`
                if (o.name) return o.bank ? `${o.name} (${o.bank})` : String(o.name)
                return 'details'
            }
            return String(x)
        }).join(', ')
    }
    return 'updated details'
}
