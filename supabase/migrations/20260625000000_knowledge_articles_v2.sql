-- Knowledge articles v2 patch.
-- Adds a focused "tenure caps quick reference" article so general tenure
-- questions no longer pull the equity-loan-tenure article.
-- Also tightens tags on the equity loan tenure article to prevent it from
-- matching general tenure queries.

-- ── 1. Add general tenure quick-reference article ─────────────────────────────

INSERT INTO knowledge_articles (title, content, category, tags, case_types, step_keys, status) VALUES

('Loan tenure caps — quick reference',
'The maximum loan tenure depends on the property type:
- Private property (condo, landed, EC): 35 years maximum
- HDB flat: 30 years maximum

Both caps are further reduced by two formulas — the shorter result wins:

Formula 1 (age): min(tenure cap, 75 − borrower age)
Formula 2 (property age): tenure cap − (current year − year of purchase) − 1

If there are multiple borrowers and income figures are entered, the Income-Weighted Average Age (IWAA) is used instead of a simple average. This can extend the tenure if the younger borrower earns more.

Minimum tenure: 5 years. If the result of both formulas is below 5, the loan is not viable at this age.

Quick examples at age 35 (property purchased 2015, current year 2026):
- Private: Formula 1 = min(35, 40) = 35 yrs. Formula 2 = 35 − 11 − 1 = 23 yrs. Max = 23 yrs.
- HDB: Formula 1 = min(30, 40) = 30 yrs. Formula 2 = 30 − 11 − 1 = 18 yrs. Max = 18 yrs.

At age 35 on a newer property (purchased 2022): private max = min(35, 40) vs (35−4−1=30) = 30 yrs.',
'Refinancing Eligibility',
ARRAY['tenure','max tenure','longest tenure','how long','loan duration','age cap','75','30 years','35 years','hdb','private','year of purchase','formula','iwaa','minimum tenure','5 years'],
ARRAY['Refinancing','Purchase','Decouple','Equity Loan'],
ARRAY['fact_find','qualify','tdsr_assessment'],
'published');

-- ── 2. Tighten equity loan tenure article tags ────────────────────────────────
-- Remove the generic 'tenure' tag so it does not match general tenure queries.
-- Rename to make the title unmistakably equity-loan-specific.

UPDATE knowledge_articles
SET
    title   = 'Equity loan — tenure calculation and TDSR waiver',
    tags    = ARRAY['equity loan tenure','age cap only','no purchase year constraint','home loan tenure','dual formula','iwaa','tdsr waiver','own-stay','investment','equity loan'],
    content = 'The equity loan and the home loan use different tenure rules. This matters when computing monthly payments for TDSR.

Home loan tenure (when refinancing alongside an equity loan):
Two formulas apply — the shorter wins:
- Formula 1: min(35, 75 − ceil(borrower age))
- Formula 2: 35 − (current year − year of purchase) − 1
Minimum: 5 years.

Equity loan tenure (the equity loan itself):
Only the age cap applies — there is NO property-purchase-year constraint for equity loans:
- Max tenure = min(35, 75 − ceil(borrower age))
- Minimum: 5 years.

Practical effect: on an old property where the home loan tenure is severely compressed by Formula 2, the equity loan can still use a longer tenure (age cap only), making the equity loan monthly payment lower per dollar borrowed.

IWAA applies to both when income is entered — same as for refinancing.

TDSR waiver (own-stay properties only):
If the existing home loan fails TDSR, most banks offer a TDSR waiver for own-stay properties — verify with the banker. For investment properties: no waiver; client must pay down approximately 3% of the outstanding loan and/or show funds.'
WHERE title = 'Equity Loan — tenure rules (home loan vs equity loan)';
