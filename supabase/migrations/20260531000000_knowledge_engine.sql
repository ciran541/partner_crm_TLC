-- Layer 4: Embedded Knowledge Engine
-- Admin-managed knowledge repository. Agents only ever receive filtered/search
-- results via server API routes (never an unfiltered list).

CREATE TABLE IF NOT EXISTS knowledge_articles (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title       text NOT NULL,
    content     text NOT NULL,
    category    text NOT NULL,
    tags        text[] DEFAULT '{}',
    case_types  text[] DEFAULT '{}',
    step_keys   text[] DEFAULT '{}',
    status      text NOT NULL DEFAULT 'published',
    created_by  uuid,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE knowledge_articles IS 'Layer 4 knowledge repository. Admin CRUD; agents get search + contextual results only via API.';

-- Tag + step-key indexes (keyword search uses ILIKE on title/content; the article
-- count is small, so a full-text tsvector index is unnecessary).
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON knowledge_articles USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_step_keys ON knowledge_articles USING GIN (step_keys);

-- RLS: enabled, no client policies. All access flows through server API routes
-- using the service-role client after auth. This prevents agents from ever
-- dumping the full library.
ALTER TABLE knowledge_articles ENABLE ROW LEVEL SECURITY;

-- ── Seed: the expert knowledge already written into the Refinancing workflow ──
INSERT INTO knowledge_articles (title, content, category, tags, case_types, step_keys, status) VALUES

('Subsidy and clawback — what to watch for',
'Subsidies are very common. Most banks offer $1,500–$3,000 in legal fee rebates or cashback to incentivise customers to take their loan.

Clawback clause typically runs 3 years from the disbursement date. The amount is usually the full subsidy if refinanced within year 1, prorated in years 2–3. Some banks have full-clawback-for-full-term clauses.

Always get the actual subsidy letter — never rely on the client''s memory of the amount.',
'Clawback', ARRAY['subsidy','clawback','cashback','rebate','penalty'], ARRAY['Refinancing'], ARRAY['fact_find','risk_suitability'], 'published'),

('TDSR calculation — what you need to know',
'TDSR (Total Debt Servicing Ratio) is capped at 55% of gross monthly income.

Formula: (all monthly debt obligations including the new mortgage) ÷ gross monthly income ≤ 55%.

Example: Client earns $6,000 gross with a $400/month car loan. Maximum total monthly debt = $3,300. If the new mortgage is $2,500, total is $2,900 — within TDSR.

For HDB loans there is an additional MSR (Mortgage Servicing Ratio) cap: the mortgage alone cannot exceed 30% of gross income. MSR applies only to HDB and Executive Condominiums.',
'TDSR/MSR', ARRAY['tdsr','msr','income','servicing','ratio','eligibility'], ARRAY['Refinancing'], ARRAY['fact_find','risk_suitability'], 'published'),

('CPF usage and its implications',
'If the client uses CPF OA for monthly repayments, the CPF Board accrues interest at 2.5% on the amounts used. When the property is sold, these accrued amounts must be refunded to CPF.

This does not block refinancing, but clients sometimes confuse "CPF principal + accrued interest" with "outstanding loan" — they are separate obligations.

Note whether CPF is used monthly, as this affects the cashflow analysis.',
'CPF', ARRAY['cpf','accrued interest','refund','oa'], ARRAY['Refinancing'], ARRAY['fact_find'], 'published'),

('How SORA works for floating packages',
'SORA is the Singapore Overnight Rate Average, published daily by MAS. It replaced SIBOR as the benchmark for floating-rate mortgages from 2024.

Most floating packages are quoted as "1M Compounded SORA + spread" or "3M Compounded SORA + spread". Example: 3M SORA at 3.2% + spread 0.6% = effective rate 3.8%.

1M SORA resets monthly — more responsive to rate changes. 3M SORA resets quarterly — slightly more stable month-to-month.

SORA-linked packages have no floor rate, so they benefit when SORA drops. FD Rate packages are tied to a bank''s fixed deposit rate — less transparent but sometimes competitive.',
'Fixed vs Floating', ARRAY['sora','floating','sibor','benchmark','spread','fd rate'], ARRAY['Refinancing'], ARRAY['fact_find','risk_suitability'], 'published'),

('Fixed vs floating — how to explain it simply',
'Fixed rate means the monthly payment stays exactly the same for the first 1, 2, or 3 years — great for budgeting. After the fixed period it reverts to a floating rate.

Floating rate moves with market rates — currently often a bit lower than fixed, but it can rise.

"Fixed" never means fixed forever in Singapore — only for the initial lock-in years. Always clarify this with the client so they are not surprised when the rate reverts.',
'Fixed vs Floating', ARRAY['fixed','floating','rate preference','lock-in'], ARRAY['Refinancing'], ARRAY['risk_suitability'], 'published'),

('Risk flag decision tree',
'Urgent lock-in (< 90 days): act fast — prioritise submission timeline over perfect rate optimisation.

Clawback risk: compute net savings. Net saving = (old monthly − new monthly) × months remaining in clawback period, minus clawback amount. If negative, refinancing is not recommended.

Selling risk: if selling within the new lock-in period, the client pays another penalty. Recommend no/short lock-in if selling in 2–3 years.

Income risk: if income is dropping, verify TDSR still holds at the projected income. A conditional approval may come back with a lower quantum.

TDSR concern: above 45% (approaching the 55% cap) — flag it; the bank may apply a more conservative stress test.',
'Refinancing Risks', ARRAY['risk','lock-in','clawback','selling','income','tdsr'], ARRAY['Refinancing'], ARRAY['risk_suitability'], 'published'),

('Net savings formula — what to include',
'Net savings = (Current monthly − New monthly) × months until next refi window
  − Clawback to current bank
  − Legal/conveyancing fees if the new bank does not subsidise (~$1,500–$2,500)
  − Penalty if currently in lock-in (typically 1.5% of outstanding)

If the new bank offers a legal fee subsidy, that offsets costs. Use the end of the new lock-in period as the comparison horizon — that is the true window.',
'Refinancing Risks', ARRAY['net savings','calculation','clawback','penalty','legal fees'], ARRAY['Refinancing'], ARRAY['research_proposal'], 'published'),

('When refinancing is worth pursuing',
'The window that makes economic sense: lock-in has expired OR will expire within 3 months, AND the current rate is at least 0.3–0.5% above what market packages offer.

Below that spread, the savings after legal fees rarely justify the effort. Rule of thumb: for a $500K loan, each 0.1% rate reduction saves roughly $500/year. At $2K legal fees, the client needs ~4 years of savings to break even at that spread. For larger loans the threshold is proportionally lower.',
'Refinancing Risks', ARRAY['qualify','worth it','spread','break even','lock-in'], ARRAY['Refinancing'], ARRAY['qualify'], 'published'),

('What banks check on each document',
'Payslips: must be consecutive months with no gap. Banks verify employer name, NRIC, salary, and CPF deduction.

CPF statement: cross-checked against payslips to verify income consistency.

Loan statement: confirms outstanding principal (determines LTV) and checks for arrears.

NOA (self-employed): the bank uses IRAS-declared income, sometimes lower than actual drawings — this can affect TDSR. Warn self-employed clients early.

NRIC: must not be expired — a common oversight that causes rejections.',
'Documents', ARRAY['documents','payslip','cpf','noa','nric','loan statement'], ARRAY['Refinancing'], ARRAY['collect_documents'], 'published'),

('IPA vs Letter of Offer — know the difference',
'IPA (In-Principle Approval): the bank''s preliminary assessment. Confirms the client is eligible but is NOT binding.

Letter of Offer (LoO): the binding offer specifying exact rate, tenure, terms, clawback (if the new bank also provides a subsidy), and acceptance deadline.

Never advise the client to act on an IPA — always wait for the LoO.',
'Approval', ARRAY['ipa','letter of offer','loo','approval','binding'], ARRAY['Refinancing'], ARRAY['followup_approval','letter_offer'], 'published'),

('Why retention is the most important step',
'A client who refinanced with your help is the easiest future sale you will ever have. They trust you, and in 2 years they face the exact same situation.

Almost every Singapore borrower refinances every 2–3 years at lock-in expiry. If you do not set the reminder now, a competitor will reach them first.

Optimal contact window: 3 months before the new lock-in expiry — enough time to review rates, prepare, collect documents, and complete before any penalty applies.',
'Retention', ARRAY['retention','reminder','repeat','lock-in expiry','referral'], ARRAY['Refinancing'], ARRAY['close_retention'], 'published');
