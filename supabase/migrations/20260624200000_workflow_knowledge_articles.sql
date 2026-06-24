-- Knowledge articles derived from workflow logic for all four case types.
-- Source: refiCalc.ts, purchaseCalc.ts, decoupleCalc.ts, loanCalc.ts,
--         EquityLoanWorkflow.tsx, DecouplingWorkflow.tsx
-- These cover the majority of agent questions that the workflow logic can answer.
-- Numbers and rules are transcribed verbatim from the calculation engines.

INSERT INTO knowledge_articles (title, content, category, tags, case_types, step_keys, status) VALUES

-- ── Shared / cross-case-type ──────────────────────────────────────────────────

('How banks count income for mortgage eligibility',
'Banks split income into two components when computing TDSR and MSR capacity.

Employed borrowers:
- Basic salary: counted in full (monthly amount).
- Bonus / variable income: haircut to 70% then divided by 12.
  Monthly effective income = basic salary + (annual variable × 70% ÷ 12).

Self-employed borrowers:
- No basic salary is counted.
- Only the IRAS Notice of Assessment (NOA) income is accepted.
  Monthly effective income = annual NOA × 70% ÷ 12.
- NOA income is often lower than actual drawings. Warn self-employed clients early — their TDSR ceiling may surprise them.

Multiple borrowers:
All borrowers'' effective monthly incomes are summed.

Income-Weighted Average Age (IWAA):
When income figures are entered, the system uses IWAA instead of a simple average age for tenure calculation. Each borrower''s age is weighted by their effective monthly income. This biases the "age" towards the higher earner, typically the younger borrower, which can extend the maximum loan tenure. If no income is entered, a simple average of all ages is used instead.',
'Income & Eligibility',
ARRAY['income','variable','noa','self-employed','bonus','iwaa','weighted age','effective income'],
ARRAY['Refinancing','Purchase','Decouple','Equity Loan'],
ARRAY['fact_find','tdsr_assessment'],
'published'),

('TDSR and MSR — which cap applies to your case type',
'TDSR (Total Debt Servicing Ratio): total monthly debt obligations cannot exceed 55% of gross monthly income. Applies to ALL property types.

MSR (Mortgage Servicing Ratio): the mortgage payment alone cannot exceed 30% of gross monthly income. Applies ONLY to certain property types:
- Refinancing: HDB flats, Completed EC (MOP not obtained), Incomplete EC (No CSC)
- New Purchase: Resale HDB, BTO, EC New Launch

When both TDSR and MSR apply (e.g. EC New Launch, Completed EC without MOP, HDB), the lower cap always binds. MSR is always the tighter constraint.

Stress-test rate: all eligibility calculations use 4.0% p.a., not the actual package rate. This ensures the borrower can still service the loan if rates rise.

Formulas:
- TDSR capacity = (gross income × 55%) − existing monthly debt commitments
- MSR capacity = gross income × 30%
- When both apply: take the lower of the two

Neither TDSR nor MSR capacity is the same as loan size — the maximum loan is derived from the capacity using the stress-test rate and the tenure.',
'TDSR/MSR',
ARRAY['tdsr','msr','55%','30%','stress test','4%','hdb','ec','servicing ratio'],
ARRAY['Refinancing','Purchase','Decouple','Equity Loan'],
ARRAY['fact_find','tdsr_assessment','risk_suitability'],
'published'),

('Pledge and show funds — bridging a TDSR shortfall',
'When a client''s income falls short of the TDSR requirement for a given loan amount, banks offer two remedies.

Pledge funds: a sum placed in a fixed deposit with the bank, locked for 4 years. This increases the bank''s security and effectively raises the client''s borrowing ceiling.

Show funds: a larger sum (~3.33× the pledge) held in liquid assets. Not locked, but must be demonstrated at the time of application.

Approximate formula:
- Pledge ≈ (shortfall monthly payment × 48) ÷ 0.55
- Show ≈ Pledge ÷ 0.30

Example: If the TDSR shortfall creates a monthly payment gap of $600 →
Pledge ≈ ($600 × 48) ÷ 0.55 ≈ $52,364. Show ≈ $52,364 ÷ 0.30 ≈ $174,545.

Property use distinction:
- Own-stay property: most banks offer a TDSR waiver on existing mortgage refinancing — check with the banker first. This may remove the TDSR check entirely.
- Investment property: no TDSR waiver available. Bank requires the client to pay down approximately 3% of the outstanding loan and/or show funds. Pledge/show is the only route.

Pledge/show applies per loan: if there are multiple loans (e.g. home loan + equity loan), each shortfall is calculated separately and the amounts can be combined.',
'TDSR/MSR',
ARRAY['pledge','show funds','tdsr shortfall','fixed deposit','locked funds','waiver','investment','own-stay'],
ARRAY['Refinancing','Purchase','Decouple','Equity Loan'],
ARRAY['tdsr_assessment','risk_suitability'],
'published'),

-- ── Refinancing articles ──────────────────────────────────────────────────────

('Refinancing — property types and what changes with each',
'The property type determines: the tenure cap, whether MSR applies, whether equity loan and decoupling are options, and whether there is an undisbursed loan balance (BUC).

HDB:
- Tenure cap: 30 years. MSR applies. No equity loan. No decoupling.

Landed:
- Tenure cap: 35 years. No MSR. Equity loan: yes. Decoupling: yes.

Completed Condo (CSC obtained):
- Tenure cap: 35 years. No MSR. Equity loan: yes. Decoupling: yes.

Incomplete Condo (No CSC — still under construction):
- Tenure cap: 35 years. No MSR. Decoupling: yes. Equity loan: NO (CSC required).
- Has an undisbursed loan balance — cancellation fee applies if refinancing.

Completed EC (CSC & MOP obtained):
- Tenure cap: 35 years. No MSR. Equity loan: yes. Decoupling: yes.

Completed EC (CSC obtained, MOP NOT yet obtained):
- Tenure cap: 35 years. MSR applies. Equity loan: NO. Decoupling: NO.

Incomplete EC (No CSC):
- Tenure cap: 35 years. MSR applies. Equity loan: NO. Decoupling: NO.
- Has an undisbursed loan balance — cancellation fee applies if refinancing.

Equity loan eligibility requires: private property + CSC obtained + MOP obtained (for EC) + no undisbursed balance.
Decoupling eligibility requires: private property + CSC obtained (for condo/EC). Incomplete Condo can still be decoupled even without CSC. EC without MOP cannot be decoupled.',
'Refinancing Eligibility',
ARRAY['property type','hdb','landed','condo','ec','mop','csc','buc','tenure cap','msr','equity loan','decouple'],
ARRAY['Refinancing'],
ARRAY['fact_find','qualify'],
'published'),

('Refinancing — how maximum loan tenure is calculated',
'Maximum tenure = the SHORTER of two formulas. Banks use whichever gives a shorter tenure.

Formula 1 (age-based): min(tenure cap, 75 − borrower age)
Formula 2 (property-age-based): tenure cap − (current year − year of purchase) − 1

Tenure caps: 30 years for HDB, 35 years for all private properties.
Minimum tenure: 5 years (a result below 5 means refinancing is not viable).
Maximum borrower age: 75. If the weighted age is 71 or above, the minimum tenure of 5 years cannot be achieved without exceeding age 75 — refinancing is blocked.

The "borrower age" used:
- When income is entered: Income-Weighted Average Age (IWAA). Each borrower''s age is weighted by their effective monthly income. A younger, higher-earning borrower can pull the IWAA down, extending the tenure.
- When income is not entered: simple average of all borrowers'' ages.

Example (private property, purchased 2010, current year 2026, borrower age 45):
Formula 1: min(35, 75 − 45) = min(35, 30) = 30 years
Formula 2: 35 − (2026 − 2010) − 1 = 35 − 16 − 1 = 18 years
Max tenure = min(30, 18) = 18 years — Formula 2 binds here.',
'Refinancing Eligibility',
ARRAY['tenure','max tenure','formula','age','year of purchase','iwaa','hdb','private','30 years','35 years'],
ARRAY['Refinancing'],
ARRAY['fact_find','qualify','tdsr_assessment'],
'published'),

('Refinancing costs — legal fees, valuation, and subsidies by property type',
'All figures are estimates. The subsidy comes from the NEW bank; the clawback is owed to the CURRENT bank — these are separate amounts.

HDB:
- Legal fee: ~$1,500 (nett cash/CPF, after subsidy)
- Valuation: ~$200 (cash)
- Estimated subsidy from new bank: $2,000 if outstanding loan ≥ $250,000; $0 if below

Private property — standard refinancing:
- Legal fee: ~$1,800 (nett cash/CPF)
- Valuation: $400–$1,000 (cash, refer to valuation table by price tier)
- Estimated subsidy from new bank: $2,500 if total outstanding ≥ $1,000,000; $2,000 if ≥ $500,000; $0 if below $500,000

Private property — refinancing with a new equity loan:
- Legal fee: ~$2,100 (nett cash/CPF, higher due to equity loan documentation)
- Valuation: $400–$1,000 (cash)
- Subsidy: same thresholds as standard private

Private property — client is decoupling at the same time as refinancing:
- Legal fee: ~$6,000 (est. cash/CPF — covers both refinancing and conveyancing for decoupling)
- Valuation: $400–$1,000 (cash)
- Subsidy: same thresholds as standard private

Small loan warning:
If the private outstanding is below $500,000, or the HDB outstanding is below $250,000, most banks will not offer a subsidy — factor this into the net savings calculation.',
'Fees & Costs',
ARRAY['legal fee','valuation','subsidy','cost','refinancing cost','hdb','private','equity loan','decouple'],
ARRAY['Refinancing'],
ARRAY['research_proposal','qualify'],
'published'),

('Cancellation fee on incomplete (BUC) properties',
'If a property is still under construction — Incomplete Condo or Incomplete EC (no Certificate of Statutory Completion yet) — there is an undisbursed portion of the loan. This is the balance the bank has committed to disburse progressively as construction milestones are reached, but has not yet paid out.

If the client refinances before the CSC is obtained, the current bank charges a cancellation fee on the undisbursed balance:

Cancellation fee = undisbursed balance × 0.75%

This fee is in addition to any lock-in penalty and any subsidy clawback. Always check the undisbursed balance before recommending refinancing on a BUC property — the cancellation fee can significantly erode net savings.

Note: equity loans are not available on incomplete properties. The CSC must be obtained first before an equity loan can be taken. Decoupling, however, is possible on Incomplete Condo (not on Incomplete EC).',
'Refinancing Risks',
ARRAY['cancellation fee','undisbursed','buc','incomplete condo','incomplete ec','csc','0.75%'],
ARRAY['Refinancing'],
ARRAY['fact_find','risk_suitability','qualify'],
'published'),

-- ── New Purchase articles ─────────────────────────────────────────────────────

('New Purchase — property types, servicing rules, and eligibility restrictions',
'The property type determines which debt servicing ratio applies, foreigner eligibility, and how outstanding loans affect the LTV calculation.

Resale Condo: TDSR only. No restrictions on foreigner borrowers.
New Launch Condo: TDSR only. No restrictions on foreigner borrowers. BUC property.
Resale Landed: TDSR only. No restrictions on foreigner borrowers.
EC New Launch: TDSR + MSR (the lower binds). Foreigner borrowers NOT allowed. Outstanding housing loans are treated as 0 for LTV purposes. BUC property.
Resale HDB: MSR only. Foreigner borrowers NOT allowed. LTV always calculated at 0-outstanding-loan rate.
BTO: MSR only. Foreigner borrowers NOT allowed. LTV always calculated at 0-outstanding-loan rate. BUC property.

"LTV always at 0-outstanding-loan rate" means: for Resale HDB, BTO, and EC New Launch, the system applies the 75% maximum loan LTV regardless of how many existing housing loans the client has. This reflects MAS rules where these property types are subject to first-loan LTV constraints.

"BUC" (Building Under Construction) affects package filtering — some packages are only available for completed properties, and certain remarks about progressive payment apply.',
'New Purchase',
ARRAY['property type','resale condo','new launch','landed','ec','hdb','bto','tdsr','msr','foreigner','ltv','buc'],
ARRAY['Purchase'],
ARRAY['fact_find','qualify'],
'published'),

('New Purchase — LTV and downpayment matrix by outstanding loans',
'The maximum loan-to-valuation (LTV) and minimum cash required depend on how many existing housing loans the borrower has.

0 existing housing loans (first property loan):
Option 1 (age cap 65 at end of loan):
  - Max loan: 75% of price
  - Min cash: 5% of price
  - Balance in cash/CPF: 20% of price
  - Max tenure: 30 yrs (condo/EC), 25 yrs (HDB), capped by (65 − weighted age)
Option 2 (age cap 75 at end of loan):
  - Max loan: 55% of price
  - Min cash: 10% of price
  - Balance in cash/CPF: 35% of price
  - Max tenure: 35 yrs (condo/EC), 30 yrs (HDB), capped by (75 − weighted age)

1 existing housing loan:
Option 1: Max loan 45%, min cash 25%, balance 30% cash/CPF. Tenure same as above.
Option 2: Max loan 25%, min cash 25%, balance 50% cash/CPF. Tenure same as above.

2 or more existing housing loans:
Option 1: Max loan 35%, min cash 25%, balance 40% cash/CPF. Tenure same.
Option 2: Max loan 15%, min cash 25%, balance 60% cash/CPF. Tenure same.

How the two options work:
Option 1 uses age cap 65 — a shorter tenure resulting in a higher monthly instalment but higher LTV.
Option 2 uses age cap 75 — a longer tenure resulting in a lower monthly instalment but lower LTV and a larger cash/CPF outlay.

Tenure formula: min(ageCap − weighted borrower age, property cap).
Property caps: condo/EC use 30 yrs (Opt 1) or 35 yrs (Opt 2); HDB uses 25 yrs (Opt 1) or 30 yrs (Opt 2).

The final loan is the lower of the income-based eligibility (TDSR/MSR) and the LTV ceiling. Income and LTV are two separate constraints — both must be met.',
'New Purchase',
ARRAY['ltv','downpayment','loan matrix','75%','55%','45%','35%','25%','15%','option 1','option 2','cash','cpf','outstanding loans'],
ARRAY['Purchase'],
ARRAY['fact_find','qualify','tdsr_assessment'],
'published'),

('New Purchase — stamp duties (BSD and ABSD)',
'Buyer''s Stamp Duty (BSD) applies to all purchases. It is tiered:
- First $180,000: 1%
- $180,001 to $360,000: 2%
- $360,001 to $1,000,000: 3%
- $1,000,001 to $1,500,000: 4%
- $1,500,001 to $3,000,000: 5%
- Above $3,000,000: 6%

Additional Buyer''s Stamp Duty (ABSD) applies based on residency and how many residential properties the buyer already owns:

Singapore Citizen: 0% (1st property), 20% (2nd), 30% (3rd and beyond)
Permanent Resident: 5% (1st), 30% (2nd), 35% (3rd and beyond)
Foreigner: 60% (all purchases)

"Properties owned" is based on residential properties owned, not housing loans outstanding. Always confirm both separately.

Married couple nuance: if co-buyers are a married couple and at least one is a Singapore Citizen, the SC rate applies — 0% for a first purchase. ABSD remission is available. This does not apply to unmarried joint buyers; they use the worst-case rate (highest residency among all buyers).

ABSD is computed on the full purchase price, not just the loan amount.',
'Stamp Duty',
ARRAY['bsd','absd','stamp duty','buyer stamp duty','sc','pr','foreigner','married','remission','residential property'],
ARRAY['Purchase'],
ARRAY['fact_find','research_proposal'],
'published'),

('New Purchase — legal fees and valuation fees by property type',
'Estimates only. These are standard market rates; actual amounts may vary by lawyer.

Legal fees (est.):
- BTO: ~$2,000
- Resale HDB: ~$1,800
- Resale Condo: ~$2,500
- New Launch Condo: ~$2,800
- EC New Launch: ~$2,800
- Resale Landed: ~$3,000

Valuation fees (est.):
- BTO: $0 (no valuation required for new HDB flats)
- Resale HDB: ~$120
- New Launch Condo: ~$100
- EC New Launch: ~$100
- Resale Condo: ~$500 (below $3M); ~$700 ($3M–$5M); formula above $5M (incl. 9% GST)
- Resale Landed: ~$550 (below $3M); ~$750 ($3M–$5M); formula above $5M (incl. 9% GST)

Unlike refinancing, banks generally do not subsidise the legal fees for a new purchase. The buyer pays these costs upfront, in addition to stamp duties and the downpayment.',
'Fees & Costs',
ARRAY['legal fee','valuation fee','new purchase','bto','hdb','condo','landed','ec','costs'],
ARRAY['Purchase'],
ARRAY['research_proposal','fact_find'],
'published'),

('New Purchase — IPA path vs income-based calculation',
'When a client already has an IPA (In-Principle Approval) from a bank, the system uses the bank-approved loan amount and tenure directly, rather than computing from income figures. The bank has already conducted its own TDSR/MSR assessment.

On the IPA path:
- The final loan is the lower of the IPA amount and the LTV ceiling (75%/45%/35% depending on outstanding loans). If the IPA is above the LTV ceiling, the ceiling applies.
- If the IPA amount is below the LTV ceiling, the system shows how much additional funds the client could pledge or show to potentially reach the full LTV ceiling.
- The tenure from the IPA is used directly, capped by the bank''s age limit (Option 1 = age 65 cap; Option 2 = age 75 cap).

Without IPA (income-based):
- Effective monthly income is computed from each borrower''s salary and variable income.
- Servicing capacity (TDSR or MSR depending on property type) is compared against the stress-tested payment at 4.0%.
- The maximum eligible loan from income is derived, then capped at the LTV ceiling.

Critical: An IPA is not binding. Only the Letter of Offer (LoO) is binding. Never advise a client to exercise an Option to Purchase (OTP) based solely on an IPA — they must wait for the LoO.',
'Approval',
ARRAY['ipa','in-principle approval','letter of offer','loo','otp','binding','income path','ltv ceiling','pledge'],
ARRAY['Purchase'],
ARRAY['fact_find','followup_approval','letter_offer'],
'published'),

-- ── Decoupling articles ───────────────────────────────────────────────────────

('Decoupling — what it is and why clients do it',
'Decoupling is when one co-owner (the "seller") transfers their share of a jointly-owned property to the other co-owner (the "buyer"), resulting in single ownership.

Why do clients decouple?
The primary driver is ABSD savings. A married Singaporean couple who jointly own a property will pay 20% ABSD if they buy a second property together. After decoupling, the seller becomes a sole owner of nothing — they are a first-time buyer again. They can then purchase another property at 0% ABSD (for SC) instead of 20%.

The savings on a $1.5M property: 20% ABSD = $300,000. Even after accounting for BSD, legal fees, and other decoupling costs, the savings are typically large.

Which properties can be decoupled?
Private properties only: Completed Condo, Completed EC (MOP obtained), Incomplete Condo (TOP obtained but no CSC), and Landed.
Cannot decouple: HDB flats (any type), Completed EC without MOP, Incomplete EC, any property under HDB''s ownership rules.

Who is the buyer vs seller?
Typically the person who wants to be "freed up" to buy another property becomes the seller. The buyer becomes the sole owner and takes on the full loan obligation.',
'Decoupling',
ARRAY['decouple','absd','single owner','co-owner','stamp duty savings','second property','private property'],
ARRAY['Decouple'],
ARRAY['fact_find','qualify'],
'published'),

('Decoupling — four scenarios (S1, S2, S3, S4)',
'The decoupling scenario is determined by two questions:
1. Does the buyer need a new bank loan to purchase the seller''s share?
2. Is the property''s existing mortgage fully paid off?

S1 — No new financing, has existing mortgage:
The buyer does not need a new loan for the seller''s share. However, there is an existing mortgage, so it is refinanced into the buyer''s sole name. TDSR applies to the refinanced loan.

S2 — New financing, property is fully paid:
The buyer takes a new bank loan (up to 75% of the seller''s share value, minimum $100,000) to purchase the seller''s share. Since the property was fully paid, only purchase TDSR applies. 5% mandatory cash downpayment required.

S3 — New financing, has existing mortgage:
The most complex scenario. Both happen simultaneously: the existing mortgage is refinanced into the buyer''s name, and the buyer takes a new purchase loan for the seller''s share. TDSR is assessed for both, with the refinancing loan taking priority — the purchase loan is assessed against the remaining TDSR headroom after the refi obligation is accounted for.

S4 — No new financing, property fully paid:
The buyer pays for the seller''s share entirely in cash and/or CPF. No bank loan involved, no TDSR assessment needed. The simplest scenario.

Tenure caps by scenario:
- Refi loan (S1, S3): max tenure = shorter of (35 − years since purchase − 1) and (75 − borrower age), capped at 35 years. Min 5 years.
- Purchase loan (S2, S3): max tenure = min(65 − weighted age, 30 years). Note the age cap is 65 (not 75) for the new purchase loan.',
'Decoupling',
ARRAY['scenario','s1','s2','s3','s4','refi','purchase loan','fully paid','tdsr','tenure'],
ARRAY['Decouple'],
ARRAY['fact_find','tdsr_assessment','qualify'],
'published'),

('Decoupling — stamp duties (BSD, ABSD, SSD) on the part-purchase',
'All stamp duties are calculated on the seller''s share value (= property valuation × seller''s ownership percentage), not the full property value.

Buyer''s Stamp Duty (BSD) — paid by the buyer:
Same tiered rates as any property purchase:
1% on first $180,000 / 2% up to $360,000 / 3% up to $1,000,000 / 4% up to $1,500,000 / 5% up to $3,000,000 / 6% above $3,000,000.

Additional Buyer''s Stamp Duty (ABSD) — paid by the buyer:
Based on the buyer''s residency (as an individual acquiring the seller''s share):
- Singapore Citizen: 0%
- Permanent Resident: 5%
- Foreigner: 60%
Note: the married-couple SC remission that applies in new purchases does NOT apply here — decoupling ABSD uses the individual buyer''s residency only.

Seller''s Stamp Duty (SSD) — paid by the seller:
Only triggered if the property was purchased in 2023 or later. Calculated on the seller''s share value.

Properties purchased 2023–2024 ("old" SSD rates):
- Held less than 1 year: 12%
- Held 1 to 2 years: 8%
- Held 2 to 3 years: 4%
- Held 3 or more years: 0%

Properties purchased 2025 or later ("new" SSD rates):
- Held less than 1 year: 16%
- Held 1 to 2 years: 12%
- Held 2 to 3 years: 8%
- Held 3 to 4 years: 4%
- Held 4 or more years: 0%

Properties purchased 2022 or earlier: no SSD (past the holding period entirely).

"Years held" is calculated as current calendar year minus year of purchase. For exact SSD amounts, verify against IRAS — rates and rules can change.

Legal fees: ~$3,000 for both the buyer and the seller.
Cancellation fee: 0.75% of undisbursed balance, only for Incomplete Condo (no CSC).',
'Stamp Duty',
ARRAY['bsd','absd','ssd','stamp duty','decoupling','seller stamp duty','buyer stamp duty','holding period','2023','2025'],
ARRAY['Decouple'],
ARRAY['fact_find','research_proposal'],
'published'),

('Decoupling — how TDSR is assessed by scenario',
'TDSR assessment depends on the scenario. S4 (cash/CPF only) requires no income documentation.

S1 (refi only):
- The existing mortgage is assessed in its entirety against the buyer''s full TDSR capacity.
- If the property also has an existing equity loan, it is assessed separately after the home loan: home loan is checked first against full TDSR, then the equity loan is checked against the remaining TDSR balance after the home loan.
- Refi tenure: max 35 years, but capped by the shorter of (35 − years since purchase − 1) and (min(35, 75 − age)). Minimum 5 years.

S2 (purchase only):
- The new purchase loan (up to 75% of the seller''s share, min $100,000) is assessed against the buyer''s full TDSR capacity.
- Purchase tenure: max 30 years, capped by (65 − weighted borrower age). Note: age cap is 65 for the purchase loan, not 75.

S3 (refi + purchase):
- The refi loan is assessed first against the full TDSR capacity.
- The purchase loan is then assessed against the REMAINING TDSR capacity after the refi stress payment.
- If the borrower fails TDSR on the refi loan, they automatically fail for the purchase loan too.
- Outcome categories: both pass / refi passes but purchase fails / both fail.

Pledge and show funds:
Shortfalls in any loan can be bridged by pledging or showing funds. Amounts are calculated per loan and can be combined if multiple loans fail. For investment properties, no TDSR waiver — the client must pay down 3% or show funds.

Equity loan TDSR (when a new equity loan is also requested):
Assessed against the remaining TDSR after both the refi and purchase obligations. The equity loan is the last in priority.',
'TDSR/MSR',
ARRAY['tdsr','scenario','s1','s2','s3','refi','purchase','equity loan','65 age cap','tenure','pledge','priority'],
ARRAY['Decouple'],
ARRAY['tdsr_assessment','fact_find'],
'published'),

-- ── Equity Loan articles ──────────────────────────────────────────────────────

('Equity Loan — who qualifies and how much they can borrow',
'An equity loan lets a private property owner borrow against the accumulated equity in their property without selling it. The funds are flexible — clients use them for renovation, investments, or other purposes.

Eligible property types (private only):
- Landed
- Completed Condo (CSC obtained)
- Completed EC (CSC obtained AND MOP obtained)

NOT eligible: HDB flats, Incomplete Condo (no CSC), Incomplete EC, Completed EC without MOP.

Maximum equity loan — LTV formula:
Available equity (%) = 75% − (outstanding home loan ÷ market price) − (total CPF used by all owners ÷ market price)
Maximum equity loan = available equity % × market price

Minimum equity loan: $50,000. If the calculated available equity is below $50,000, the client does not qualify — a higher property valuation or a lower outstanding loan is needed.

Two separate eligibility checks:
1. LTV structural check — determines the maximum loan amount (above).
2. TDSR income check — the monthly stress payment on the equity loan (at 4.0%) must fit within the client''s remaining TDSR capacity after any existing home loan obligations.

Passing the LTV check does not automatically mean the client can afford the equity loan. Both checks must be satisfied.',
'Equity Loan',
ARRAY['equity loan','ltv','75%','cpf','market price','eligible','landed','condo','ec','mop','50000','available equity'],
ARRAY['Equity Loan'],
ARRAY['fact_find','qualify','tdsr_assessment'],
'published'),

('Equity Loan — tenure rules (home loan vs equity loan)',
'The equity loan and the home loan have different tenure calculation rules. This distinction matters when computing TDSR.

Home loan tenure (when refinancing an existing mortgage along with the equity loan):
Two formulas, shorter one wins:
- Formula 1: min(35, 75 − ceil(borrower age))
- Formula 2: 35 − (current year − year of purchase) − 1
Minimum: 5 years.

Equity loan tenure (the new equity loan itself):
- Only the age cap applies: max tenure = min(35, 75 − ceil(borrower age)).
- There is NO property-purchase-year constraint for equity loans — only age matters.
- Minimum: 5 years.

Practical difference: for a property purchased many years ago where the home loan tenure is severely constrained by Formula 2, the equity loan can still have a longer tenure if the borrower is young enough. This means the equity loan monthly payment is lower than the home loan payment per dollar borrowed.

When income is entered, IWAA is used for the age figure — the same as for refinancing.

TDSR waiver (own-stay properties only):
If the existing home loan fails TDSR, most banks offer a TDSR waiver for own-stay properties — verify with the banker. For investment properties: no waiver; client must pay down approximately 3% of the outstanding loan and/or show funds.',
'Equity Loan',
ARRAY['tenure','equity loan tenure','home loan tenure','age cap','75','year of purchase','formula','iwaa','tdsr waiver','own-stay','investment'],
ARRAY['Equity Loan'],
ARRAY['fact_find','tdsr_assessment','qualify'],
'published'),

('Equity Loan — TDSR assessment order when multiple loans are present',
'When a client has an existing home loan, an existing equity loan, and wants to take a new equity loan — all three are assessed in a fixed priority order within their TDSR budget.

Assessment order (from highest to lowest priority):
1. Existing home loan (home loan tenure = dual formula: age + property year)
2. Existing equity loan (equity loan tenure = age cap only: min(35, 75 − age))
3. New equity loan requested (same tenure rule as equity loans)

Each loan is stress-tested at 4.0% p.a. against the available TDSR budget:
- Home loan: assessed against the full TDSR capacity.
- Existing equity loan: assessed against the REMAINING capacity after home loan.
- New equity loan: assessed against the REMAINING capacity after home loan + existing equity loan.

Fully paid path:
If the property is fully paid (no existing home or equity loan), only the new equity loan is assessed — against the full TDSR capacity. This is the easiest path to qualify.

LTV check for all scenarios:
Regardless of whether the property is fully paid or has loans, the LTV formula still applies:
Available equity = (75% − loanPct − cpfPct) × market price
For a fully paid property with no CPF: available equity = 75% × market price.',
'Equity Loan',
ARRAY['tdsr','order','home loan','existing equity loan','new equity loan','priority','fully paid','assessment','75%'],
ARRAY['Equity Loan'],
ARRAY['tdsr_assessment','fact_find'],
'published');
