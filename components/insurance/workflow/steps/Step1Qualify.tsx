'use client'

import { useEffect } from 'react'
import { RefinancingStep1_Qualify, FloatingRateType } from '@/lib/types/workflow'
import { Question, RadioGroup, FieldInput, FieldTextarea, ExpandableCard, ActionList, StepActions, CheckItem } from '../WorkflowStep'
import InsuranceBankDropdown from '@/components/insurance/BankDropdown'
import { monthlyInstallment } from '@/lib/insurance/loanCalc'

const FLOATING_RATE_TYPES: FloatingRateType[] = ['1M SORA', '3M SORA', 'FD Rate']
const MAX_FIXED_YEARS = 5

function YearPills({ max, value, onChange, minValue = 1 }: {
    max: number; value?: number; onChange: (v: number) => void; minValue?: number
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {Array.from({ length: max }, (_, i) => i + 1)
                .filter(yr => yr >= minValue)
                .map(yr => (
                    <button
                        key={yr}
                        type="button"
                        onClick={() => onChange(yr)}
                        className={`w-10 h-9 rounded-lg border text-sm font-semibold transition-all ${
                            value === yr
                                ? 'bg-[#052d4a] border-[#052d4a] text-white'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-[#03a9e7] hover:text-[#03a9e7]'
                        }`}
                    >
                        {yr}
                    </button>
                ))}
        </div>
    )
}

interface Props {
    data: RefinancingStep1_Qualify
    clientName?: string | null
    onChange: (patch: Partial<RefinancingStep1_Qualify>) => void
    isComplete: boolean
    onMarkComplete: () => void
    onMarkIncomplete: () => void
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString()}` }
function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function Step1Qualify({ data, clientName, onChange, isComplete, onMarkComplete, onMarkIncomplete }: Props) {
    const name = clientName || 'the client'
    const loanAmt = data.outstanding_loan
    const penalty = loanAmt ? loanAmt * 0.015 : null
    const expiryDate = data.lock_in_expiry ? fmtDate(data.lock_in_expiry) : null

    // Detect if lock-in expiry is already in the past while status still says 'in_lock_in'
    const lockInAlreadyPast = data.lock_in_status === 'in_lock_in' && data.lock_in_expiry
        && new Date(data.lock_in_expiry).getTime() < Date.now()

    // Auto-estimate the current monthly payment from loan + current rate + remaining tenure
    const currentRate = (() => {
        const rates = (data.year_rates ?? []).map(r => parseFloat(r)).filter(r => !isNaN(r))
        return rates.length ? rates[0] : undefined
    })()
    const estimatedMonthly = (loanAmt && currentRate && data.remaining_tenure)
        ? Math.round(monthlyInstallment(loanAmt, currentRate, data.remaining_tenure))
        : undefined

    // Auto-fill the rough monthly payment when it hasn't been set yet
    useEffect(() => {
        if (estimatedMonthly !== undefined && data.rough_monthly_payment === undefined) {
            onChange({ rough_monthly_payment: estimatedMonthly })
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [estimatedMonthly])

    return (
        <div className="space-y-5 pt-4">
            <ActionList actions={[
                'Call the client and open with: "I\'d love to do a quick health check on your current home loan — takes 5 minutes."',
                'Ask for current bank, current interest rate, and lock-in expiry date.',
                'Ask for approximate outstanding loan amount and remaining tenure.',
                'Note the rough monthly repayment (client can check their bank statement or app).',
                'Determine: is the rate meaningfully above market? Is lock-in clear or nearly expired?',
                'Set this step complete only if refinancing is worth pursuing. If not viable now, record the reason in notes.',
            ]} />

            <div className="space-y-2">
                <ExpandableCard variant="script" title="Opening the conversation — what to say">
                    {`"Hi ${name}, this is [Agent] from The Loan Connection. I help homeowners review their home loans and make sure they're on the best rate available. I noticed some banks have been updating their packages recently, so I wanted to do a quick 5-minute check for you. Is now an okay time?"

If the rate is not competitive:
"It looks like your current rate is actually not too far off market right now — I'd suggest we revisit in about [X months] when your lock-in is closer to expiry. I'll make a note to reach out then."`}
                </ExpandableCard>
                <ExpandableCard variant="script" title="When they're still in lock-in — how to frame it">
                    {data.lock_in_status === 'expired' || data.lock_in_status === 'no_lock_in'
                        ? `Lock-in has ${data.lock_in_status === 'expired' ? 'expired' : 'no lock-in'} — no penalty applies. This script is not needed for this case.

If the client asks about penalties: "Because your lock-in has ${data.lock_in_status === 'expired' ? 'already expired' : 'no lock-in period'}, there's no penalty for refinancing now. We can move forward at any time."`
                        : data.lock_in_status === 'in_lock_in' && loanAmt && penalty
                            ? `"${name} is still in lock-in${expiryDate ? ` until ${expiryDate}` : ''}. Refinancing today would trigger a penalty — typically 1.5% of the outstanding loan. For ${name}'s ${fmt(loanAmt)} loan, that's about ${fmt(penalty)} out of pocket.

Unless the rate difference is very significant (more than 0.5%+), it usually makes more sense to wait until the lock-in expires. That said, let's calculate together to be sure."`
                            : data.lock_in_status === 'in_lock_in'
                                ? `Fill in the outstanding loan amount above to see the actual penalty figure for ${name}.`
                                : `Select the lock-in status above to see the relevant script.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="When to pursue vs. park a case">
                    {`The window that makes economic sense: lock-in has expired OR will expire within 3 months, AND the client's current rate is at least 0.3–0.5% above what market packages are offering.

Below that spread, the savings after legal fees ($1,500–$2,500 for conveyancing) rarely justify the effort.

Rule of thumb: for a $500K loan, each 0.1% rate reduction saves roughly $500/year. Legal fees at $2K means the client needs at least 4 years of savings to break even at that spread. For larger loans, the threshold is proportionally lower.`}
                </ExpandableCard>
                <ExpandableCard variant="knowledge" title="Why rate alone doesn't tell the full story">
                    {`Board rate packages look high on paper (e.g., "Prime + 0.5%") but the effective rate clients pay depends on what the board rate actually is today. Some clients on "floating" packages are actually on very competitive effective rates.

Always ask for the last bank statement to see the actual interest charged, not just the package name.`}
                </ExpandableCard>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Question label="Lock-in status" required>
                    <RadioGroup
                        value={data.lock_in_status}
                        onChange={v => onChange({ lock_in_status: v as any, lock_in_expiry: v !== 'in_lock_in' ? undefined : data.lock_in_expiry })}
                        options={[
                            { value: 'in_lock_in', label: 'In lock-in' },
                            { value: 'expired', label: 'Expired' },
                            { value: 'no_lock_in', label: 'No lock-in' },
                        ]}
                    />
                </Question>

                {data.lock_in_status === 'in_lock_in' && (
                    <Question label="Lock-in expiry date" required>
                        <FieldInput type="date" value={data.lock_in_expiry} onChange={v => onChange({ lock_in_expiry: v })} />
                    </Question>
                )}

                {lockInAlreadyPast && (
                    <div className="sm:col-span-2 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                        <span className="text-amber-500 text-sm shrink-0 mt-0.5">⚠</span>
                        <div>
                            <p className="text-xs font-semibold text-amber-800">Lock-in expiry date is in the past</p>
                            <p className="text-xs text-amber-700 mt-0.5">
                                {expiryDate ? `The lock-in ended on ${expiryDate}.` : 'The expiry date has passed.'}{' '}
                                Update the status to <strong>Expired</strong> if the lock-in is no longer active.
                            </p>
                            <button
                                type="button"
                                onClick={() => onChange({ lock_in_status: 'expired' })}
                                className="mt-1.5 text-xs font-semibold text-amber-800 underline underline-offset-2 hover:text-amber-900"
                            >
                                Mark as Expired →
                            </button>
                        </div>
                    </div>
                )}

                <Question label="Current bank" required>
                    <InsuranceBankDropdown value={data.current_bank ?? ''} onChange={v => onChange({ current_bank: v })} placeholder="Select current bank…" />
                </Question>

                <div className="sm:col-span-2">
                    <Question label="Current package type">
                        <RadioGroup
                            value={data.interest_type}
                            onChange={v => onChange({
                                interest_type: v as any,
                                fixed_years: v === 'floating' ? undefined : data.fixed_years,
                                lock_in_years: undefined,
                                year_rates: [],
                                floating_rate_type: v === 'fixed' ? undefined : data.floating_rate_type,
                            })}
                            options={[
                                { value: 'fixed', label: 'Fixed' },
                                { value: 'floating', label: 'Floating / SORA' },
                            ]}
                        />
                    </Question>
                </div>

                {/* Fixed — how many years fixed? */}
                {data.interest_type === 'fixed' && (
                    <div className="sm:col-span-2 pl-4 border-l-2 border-slate-200 space-y-1">
                        <Question label="Fixed for how many years?">
                            <YearPills
                                max={MAX_FIXED_YEARS}
                                value={data.fixed_years}
                                onChange={yr => onChange({ fixed_years: yr, lock_in_years: undefined, year_rates: [] })}
                            />
                        </Question>
                    </div>
                )}

                {/* Both types — total lock-in period */}
                {data.interest_type && (data.interest_type === 'floating' || data.fixed_years) && (
                    <div className="sm:col-span-2 pl-4 border-l-2 border-slate-200 space-y-1">
                        <Question label="Total lock-in period">
                            <YearPills
                                max={MAX_FIXED_YEARS}
                                value={data.lock_in_years}
                                onChange={yr => onChange({
                                    lock_in_years: yr,
                                    year_rates: Array(yr).fill(''),
                                })}
                                minValue={data.interest_type === 'fixed' ? (data.fixed_years ?? 1) : 1}
                            />
                        </Question>
                        <p className="text-xs text-slate-400">Total years the client is locked in with the current bank.</p>
                    </div>
                )}

                {/* Floating years — which SORA benchmark? */}
                {data.interest_type && data.lock_in_years && (
                    (data.interest_type === 'floating' || (data.fixed_years !== undefined && data.lock_in_years > data.fixed_years))
                ) && (
                    <div className="sm:col-span-2 pl-4 border-l-2 border-slate-200">
                        <Question label="Floating rate benchmark (for floating years)">
                            <RadioGroup
                                value={data.floating_rate_type}
                                onChange={v => onChange({ floating_rate_type: v as FloatingRateType })}
                                options={FLOATING_RATE_TYPES.map(rt => ({ value: rt, label: rt }))}
                            />
                        </Question>
                    </div>
                )}

                {/* Year-by-year rate entry */}
                {data.lock_in_years && data.lock_in_years > 0 && (
                    <div className="sm:col-span-2 space-y-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Interest Rate by Year</p>
                        {Array.from({ length: data.lock_in_years }, (_, i) => {
                            const isFixed = data.interest_type === 'fixed' && i < (data.fixed_years ?? 0)
                            return (
                                <div key={i} className="flex items-center gap-3">
                                    <span className="text-xs font-bold text-slate-400 w-10 shrink-0">Yr {i + 1}</span>
                                    <div className="relative flex-1">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={data.year_rates?.[i] ?? ''}
                                            onChange={e => {
                                                const rates = [...(data.year_rates ?? Array(data.lock_in_years).fill(''))]
                                                rates[i] = e.target.value
                                                onChange({ year_rates: rates })
                                            }}
                                            placeholder="0.00"
                                            className="w-full py-2 pl-3 pr-8 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-[#03a9e7] focus:ring-2 focus:ring-[#03a9e7]/12 transition-all"
                                        />
                                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold pointer-events-none">%</span>
                                    </div>
                                    <span className={`text-xs font-bold w-28 shrink-0 ${isFixed ? 'text-[#052d4a]' : 'text-sky-600'}`}>
                                        {isFixed ? 'Fixed' : (data.floating_rate_type ?? 'Floating')}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}

                <Question label="Outstanding loan amount" required>
                    <FieldInput type="number" value={data.outstanding_loan} onChange={v => onChange({ outstanding_loan: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                </Question>

                <Question label="Remaining tenure">
                    <FieldInput type="number" value={data.remaining_tenure} onChange={v => onChange({ remaining_tenure: v ? parseInt(v) : undefined })} placeholder="e.g. 20" suffix="yrs" />
                </Question>

                <Question label="Rough monthly payment">
                    <FieldInput type="number" value={data.rough_monthly_payment} onChange={v => onChange({ rough_monthly_payment: v ? parseFloat(v) : undefined })} placeholder="0" prefix="$" />
                    {estimatedMonthly !== undefined && (
                        <p className="text-xs text-slate-400 mt-1">
                            Auto-estimated: <span className="font-semibold text-slate-600">{fmt(estimatedMonthly)}</span>
                            {data.rough_monthly_payment !== estimatedMonthly && (
                                <button
                                    type="button"
                                    onClick={() => onChange({ rough_monthly_payment: estimatedMonthly })}
                                    className="ml-2 text-[#03a9e7] hover:text-[#0284c7] font-semibold underline underline-offset-2"
                                >
                                    use this
                                </button>
                            )}
                            <span className="block text-[11px] text-slate-400 mt-0.5">From loan, current rate &amp; remaining tenure. Edit if you have the client&apos;s actual figure.</span>
                        </p>
                    )}
                </Question>
            </div>

            <div className="pt-2">
                <CheckItem
                    checked={data.worth_exploring}
                    onChange={v => onChange({ worth_exploring: v })}
                    label="Refinancing is worth pursuing for this client"
                    hint="Check this only after reviewing rate competitiveness and lock-in status"
                />
            </div>

            <Question label="Notes">
                <FieldTextarea value={data.qualify_notes} onChange={v => onChange({ qualify_notes: v })} placeholder="Any other context from the initial call…" />
            </Question>

            <StepActions
                isComplete={isComplete}
                onMarkComplete={onMarkComplete}
                onMarkIncomplete={onMarkIncomplete}
                completionLabel="Qualify complete — proceed to Fact Find"
            />
        </div>
    )
}
