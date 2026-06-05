'use client'

import { useEffect } from 'react'
import { RefinancingStep4_ResearchProposal, RefinancingStep1_Qualify, RefinancingStep2_FactFind, RefinancingStep3_RiskSuitability } from '@/lib/types/workflow'
import { Question, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'
import { ExternalLink, Calculator } from 'lucide-react'
import {
    monthlyInstallment, maxEligibleLoan, tdsrRatioForLoan, isMsrApplicable,
    TDSR_LIMIT, MSR_LIMIT,
} from '@/lib/insurance/loanCalc'
import Step4Recommendations from './Step4Recommendations'
import type { RecommendCriteria, RecommendedPackage } from '@/lib/insurance/rateRecommend'
import type { SoraRates } from '@/lib/insurance/sora'

interface Props {
    data: RefinancingStep4_ResearchProposal
    qualify: RefinancingStep1_Qualify
    factFind: RefinancingStep2_FactFind
    risk: RefinancingStep3_RiskSuitability
    clientName?: string | null
    onChange: (patch: Partial<RefinancingStep4_ResearchProposal>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString()}` }

export default function Step4ResearchProposal({ data, qualify, factFind, risk, clientName, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    const name = clientName || 'the client'
    const clawback = factFind.clawback_amount ?? 0

    // ── Inputs gathered from earlier steps ──
    const outstandingLoan = qualify.outstanding_loan
    const tenure = qualify.remaining_tenure
    const newRate = data.new_rate
    const income = (factFind.gross_monthly_income ?? 0) + (factFind.co_borrower_income ?? 0)
    const commitments = factFind.other_monthly_debts ?? 0

    // Current rate = first filled year-rate from Step 1
    const currentRate = (() => {
        const rates = (qualify.year_rates ?? []).map(r => parseFloat(r)).filter(r => !isNaN(r))
        return rates.length ? rates[0] : undefined
    })()

    // ── Build the recommendation criteria from earlier steps ──
    const preference: RecommendCriteria['preference'] =
        risk.rate_preference === 'fixed' ? 'fixed'
        : risk.rate_preference === 'floating' ? 'floating'
        : 'either'

    const criteria: RecommendCriteria = {
        outstandingLoan: outstandingLoan ?? 0,
        remainingTenureYears: tenure ?? 0,
        currentRatePct: currentRate,
        clawbackAmount: clawback,
        propertyType: factFind.property_type,
        preference,
        includeBuc: false,   // refinancing = completed property
        grossMonthlyIncome: income > 0 ? income : undefined,
        existingMonthlyDebts: commitments,
    }

    const canRecommend = (outstandingLoan ?? 0) > 0 && (tenure ?? 0) > 0

    // ── Selecting a recommended package populates the proposal fields + a snapshot ──
    const handleSelect = (rec: RecommendedPackage, sora: SoraRates | null) => {
        const avg = rec.projection.avgRateLockinPct
        onChange({
            recommended_package: `${rec.pkg.bank} — ${rec.pkg.package_name}`,
            new_rate: avg != null ? Math.round(avg * 100) / 100 : data.new_rate,
            selected_package_id: rec.pkg.id,
            selected_package_snapshot: {
                id: rec.pkg.id,
                bank: rec.pkg.bank,
                package_name: rec.pkg.package_name,
                category: rec.pkg.category,
                lockin_years: rec.pkg.lockin_years,
                rate_schedule: rec.pkg.rate_schedule,
                avg_rate_lockin_pct: avg,
                new_monthly: rec.projection.newMonthly,
                monthly_saving: rec.savings?.monthlySaving ?? null,
                net_saving_2yr: rec.savings?.netSaving2yr ?? null,
                net_saving_3yr: rec.savings?.netSaving3yr ?? null,
                sora_as_of: sora?.value_date ?? null,
                selected_at: new Date().toISOString(),
            },
        })
    }

    // ── Auto-calculations ──
    // Current monthly: prefer the agent-entered actual figure, else compute it
    const currentMonthly = qualify.rough_monthly_payment
        ?? (outstandingLoan && currentRate && tenure ? monthlyInstallment(outstandingLoan, currentRate, tenure) : undefined)

    const computedNewMonthly = (outstandingLoan && newRate && tenure)
        ? monthlyInstallment(outstandingLoan, newRate, tenure)
        : undefined

    const computedSaving = (currentMonthly !== undefined && computedNewMonthly !== undefined)
        ? currentMonthly - computedNewMonthly
        : undefined

    const computedPenalty = (qualify.lock_in_status === 'in_lock_in' && outstandingLoan)
        ? outstandingLoan * 0.015
        : undefined

    // Persist computed values into workflow data so later steps & summaries can use them
    useEffect(() => {
        const patch: Partial<RefinancingStep4_ResearchProposal> = {}
        if (computedNewMonthly !== undefined && Math.round(computedNewMonthly) !== Math.round(data.new_monthly_payment ?? -1))
            patch.new_monthly_payment = Math.round(computedNewMonthly)
        if (computedSaving !== undefined && Math.round(computedSaving) !== Math.round(data.monthly_saving ?? -1))
            patch.monthly_saving = Math.round(computedSaving)
        if (computedPenalty !== undefined && Math.round(computedPenalty) !== Math.round(data.penalty_if_in_lockin ?? -1))
            patch.penalty_if_in_lockin = Math.round(computedPenalty)
        if (Object.keys(patch).length > 0) onChange(patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [computedNewMonthly, computedSaving, computedPenalty])

    const monthlySaving = computedSaving ?? data.monthly_saving ?? 0
    const penalty = computedPenalty ?? 0
    const netSaving2yr = monthlySaving !== 0 ? (monthlySaving * 24) - clawback - penalty : null
    const netSaving3yr = monthlySaving !== 0 ? (monthlySaving * 36) - clawback - penalty : null

    // ── Eligibility (TDSR / MSR) ──
    const eligibility = (income > 0 && tenure)
        ? maxEligibleLoan({ grossMonthlyIncome: income, existingMonthlyDebts: commitments, propertyType: factFind.property_type, tenureYears: tenure })
        : undefined
    const tdsrRatio = (income > 0 && outstandingLoan && tenure)
        ? tdsrRatioForLoan({ loanAmount: outstandingLoan, tenureYears: tenure, grossMonthlyIncome: income, existingMonthlyDebts: commitments })
        : undefined
    const qualifies = (eligibility !== undefined && outstandingLoan) ? eligibility >= outstandingLoan : undefined
    const msrApplies = isMsrApplicable(factFind.property_type)

    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Review the recommended packages below — filtered for this client\'s loan, tenure, and rate preference, with savings auto-computed.',
                'Pick the best fit (it fills the proposal below). Compare 2–3 if you like — best savings vs. most stability.',
                'Check the net savings (after clawback / lock-in penalty) justify the switch.',
                'Mark the proposal ready only once the numbers hold up.',
            ]} />

            {/* Live, computed recommendations for this client */}
            {canRecommend ? (
                <Step4Recommendations criteria={criteria} selectedId={data.selected_package_id} onSelect={handleSelect} />
            ) : (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                    Fill in the outstanding loan and remaining tenure in Step 1 to get computed package recommendations.
                </div>
            )}

            {/* Fallback: browse the full rates catalogue */}
            <a
                href="/insurance/dashboard/rates"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#03a9e7] transition-colors w-fit"
            >
                <ExternalLink size={13} />
                Browse all packages on the Rates page
            </a>

            <div className="space-y-2">
                <ExpandableCard variant="script" title="How to present the net savings calculation">
                    {qualify.rough_monthly_payment && data.new_monthly_payment && data.monthly_saving
                        ? `"${name}, let me walk you through the numbers. Your current monthly payment is approximately ${fmt(qualify.rough_monthly_payment)}. The new package I'm recommending is ${data.recommended_package || '[package]'}, which brings your monthly payment down to roughly ${fmt(data.new_monthly_payment)}. That's a saving of ${fmt(data.monthly_saving)} per month.

Over 2 years, that's ${fmt(data.monthly_saving * 24)} in savings.${clawback > 0 ? ` Because of the ${fmt(clawback)} clawback, your net saving over 2 years is ${netSaving2yr !== null ? fmt(netSaving2yr) : '[calculating]'}.` : ''} That ${(netSaving2yr ?? 0) > 3000 ? 'makes good financial sense' : 'is borderline — here\'s why it still makes sense'}."`
                        : `"Let me walk you through the numbers. Your current monthly payment is approximately $[fill in Step 1]. The new package I'm recommending is [package] at [rate]%, which brings the monthly payment down to $[new payment]. That's a saving of $[monthly saving] per month. Fill in the fields below to get the personalised version of this script."`}
                </ExpandableCard>
                <ExpandableCard variant="script" title='Handling "Is the saving worth it?"'>
                    {`"I completely understand if this feels like a lot of hassle for not much saving. Let me be honest with you — if the net saving is under $3,000–$5,000 over 2 years, it's borderline.

But if you're on an $800K loan and saving $400/month, that's $9,600 over 2 years even after clawback. That's real money. The question is whether the paperwork effort and 2–3 weeks of your time is worth [net amount] to you."`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Net savings formula — what to include">
                    {`Full formula:
Net savings = (Current monthly − New monthly) × months until next refi window
  − Clawback to current bank
  − Legal/conveyancing fees if new bank doesn't subsidise (~$1,500–$2,500)
  − Penalty if currently in lock-in (typically 1.5% of outstanding)

If new bank offers legal fee subsidy, that offsets costs.

The months horizon should be until the end of the new lock-in period — that's the true comparison period.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Singapore bank packages — what to look for">
                    {`Key factors when comparing packages:
1. Rate during lock-in period — the headline selling point.
2. Reversion rate after lock-in — matters enormously for long-term holders. Some packages have attractive 2-year fixed rates but revert to a high board rate.
3. Lock-in length — shorter is better for clients who might sell or want flexibility.
4. Subsidies offered by new bank — legal fee rebates factor into net savings.
5. Partial redemption flexibility — can client make lump-sum payments without penalty during lock-in?`}
                </ExpandableCard>
            </div>

            {/* Reference data from earlier steps */}
            {(qualify.rough_monthly_payment || qualify.outstanding_loan) && (
                <div className="bg-slate-50 rounded-lg px-4 py-3 text-xs text-slate-600 space-y-1">
                    <p className="font-semibold text-slate-700 text-xs uppercase tracking-wide mb-1">Reference from earlier steps</p>
                    {qualify.current_bank && <p>Current bank: <span className="font-medium text-slate-800">{qualify.current_bank}</span></p>}
                    {qualify.year_rates && qualify.year_rates.length > 0 && (
                        <p>Current rates: <span className="font-medium text-slate-800">
                            {qualify.year_rates.map((r, i) => `Yr${i + 1}: ${r || '?'}%`).join(' / ')}
                        </span></p>
                    )}
                    {qualify.outstanding_loan && <p>Outstanding loan: <span className="font-medium text-slate-800">${qualify.outstanding_loan.toLocaleString()}</span></p>}
                    {qualify.rough_monthly_payment && <p>Current monthly payment: <span className="font-medium text-slate-800">${qualify.rough_monthly_payment.toLocaleString()}</span></p>}
                    {factFind.clawback_amount && factFind.clawback_amount > 0 && <p className="text-amber-700 font-semibold">⚠ Clawback: ${factFind.clawback_amount.toLocaleString()} (until {factFind.clawback_end_date ?? '?'})</p>}
                </div>
            )}

            {/* Eligibility check — auto-computed from income + property type */}
            {eligibility !== undefined && (
                <div className={`rounded-lg px-4 py-3 border ${qualifies ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5 ${qualifies ? 'text-emerald-700' : 'text-amber-700'}`}>
                        <Calculator size={12} /> Eligibility Check (auto-calculated)
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div>
                            <p className="text-slate-500 text-xs">Max eligible loan</p>
                            <p className="font-bold text-slate-800">{fmt(eligibility)}</p>
                            <p className="text-[10px] text-slate-400">at 4% stress rate</p>
                        </div>
                        {outstandingLoan && (
                            <div>
                                <p className="text-slate-500 text-xs">Refinancing loan</p>
                                <p className="font-bold text-slate-800">{fmt(outstandingLoan)}</p>
                            </div>
                        )}
                        {tdsrRatio !== undefined && (
                            <div>
                                <p className="text-slate-500 text-xs">TDSR usage</p>
                                <p className={`font-bold ${tdsrRatio > TDSR_LIMIT * 100 ? 'text-red-700' : 'text-slate-800'}`}>
                                    {tdsrRatio.toFixed(1)}%
                                </p>
                                <p className="text-[10px] text-slate-400">limit {TDSR_LIMIT * 100}%</p>
                            </div>
                        )}
                    </div>
                    <p className={`text-xs mt-2 font-medium ${qualifies ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {qualifies
                            ? `✓ Client qualifies to refinance the full ${fmt(outstandingLoan ?? 0)}.`
                            : `⚠ Income supports only ${fmt(eligibility)} — below the ${fmt(outstandingLoan ?? 0)} needed. May require a co-borrower or income top-up.`}
                        {msrApplies && ` MSR (${MSR_LIMIT * 100}%) applies for ${factFind.property_type?.toUpperCase()}.`}
                    </p>
                </div>
            )}

            {/* Package recommendation */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                    <Question label="Recommended package" required>
                        <FieldInput value={data.recommended_package} onChange={v => onChange({ recommended_package: v })} placeholder="e.g. DBS 2-Year Fixed @ 2.75%" />
                    </Question>
                </div>

                <Question label="New interest rate" required>
                    <FieldInput type="number" value={data.new_rate} onChange={v => onChange({ new_rate: v ? parseFloat(v) : undefined })} placeholder="e.g. 2.75" suffix="%" />
                </Question>

                <div>
                    <Question label="New monthly payment (auto)">
                        <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-800">
                            {computedNewMonthly !== undefined ? fmt(computedNewMonthly) : <span className="text-slate-400 font-normal">Enter new rate above</span>}
                        </div>
                    </Question>
                </div>
            </div>

            {/* Auto-computed savings breakdown */}
            {computedNewMonthly !== undefined && currentMonthly !== undefined && (
                <div className={`rounded-lg px-4 py-3 border ${monthlySaving > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                    <p className={`text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5 ${monthlySaving > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        <Calculator size={12} /> Savings (auto-calculated)
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                        <div>
                            <p className="text-slate-500 text-xs">Current monthly</p>
                            <p className="font-bold text-slate-800">{fmt(currentMonthly)}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs">New monthly</p>
                            <p className="font-bold text-slate-800">{fmt(computedNewMonthly)}</p>
                        </div>
                        <div>
                            <p className="text-slate-500 text-xs">Monthly saving</p>
                            <p className={`font-bold ${monthlySaving > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {monthlySaving >= 0 ? '+' : '−'}{fmt(Math.abs(monthlySaving))}
                            </p>
                        </div>
                        {netSaving2yr !== null && (
                            <div>
                                <p className="text-slate-500 text-xs">Net / 2yr{clawback > 0 || penalty > 0 ? '*' : ''}</p>
                                <p className={`font-bold ${netSaving2yr > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                    {netSaving2yr >= 0 ? '+' : '−'}{fmt(Math.abs(netSaving2yr))}
                                </p>
                            </div>
                        )}
                    </div>
                    {(clawback > 0 || penalty > 0) && (
                        <p className="text-[11px] text-slate-500 mt-2">
                            * Net of {clawback > 0 ? `${fmt(clawback)} clawback` : ''}{clawback > 0 && penalty > 0 ? ' + ' : ''}{penalty > 0 ? `${fmt(penalty)} lock-in penalty` : ''}.
                            {netSaving3yr !== null && ` Over 3 years: ${netSaving3yr >= 0 ? '+' : '−'}${fmt(Math.abs(netSaving3yr))}.`}
                        </p>
                    )}
                    {monthlySaving <= 0 && (
                        <p className="text-xs text-red-700 mt-2 font-medium">⚠ The new rate does not save money — reconsider the package or whether refinancing is worthwhile.</p>
                    )}
                </div>
            )}

            <div className="pt-2">
                <CheckItem
                    checked={data.proposal_ready}
                    onChange={v => onChange({ proposal_ready: v })}
                    label="Proposal is ready to present to the client"
                    hint="Check only after verifying net savings are positive and the recommendation is solid"
                />
            </div>

            <Question label="Proposal notes">
                <FieldTextarea value={data.proposal_notes} onChange={v => onChange({ proposal_notes: v })} placeholder="Notes on package selection, competitor comparison, or anything relevant to the proposal…" />
            </Question>

            <StepActions isComplete={isComplete} onMarkComplete={onMarkComplete} onMarkIncomplete={onMarkIncomplete} completionLabel="Proposal built — ready to present" />
        </div>
    )
}
