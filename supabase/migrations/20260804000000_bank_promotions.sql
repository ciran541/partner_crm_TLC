-- Bank promotions — time-boxed campaigns banks blast to partners ("SCB National
-- Day cash rebate, 3–16 Aug, $800 for $1m–1.5m loans, $1,200 above that").
--
-- These are perishable and tiered, so they are stored STRUCTURED rather than as
-- a blob of text: benefit_tiers is matched against a case's actual loan amount
-- at Step 4, the same reasoning behind mortgage_packages.rate_schedule.
--
-- The load-bearing column is `audience`. One bank message routinely carries two
-- different things — a cash rebate the CLIENT receives and a referral-fee bump
-- only the AGENT gets. They must never be shown in the same place: an agent
-- incentive appearing in a client-facing proposal is a real commercial problem,
-- not a cosmetic one. Each becomes its own row with its own audience, and every
-- read path filters on it.

CREATE TABLE IF NOT EXISTS bank_promotions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank            text NOT NULL,   -- must match mortgage_packages.bank spelling to badge those cards
    title           text NOT NULL,   -- e.g. 'National Day Cash Rebate'

    -- Who may see this. 'agent' rows are internal-only and are excluded from
    -- every client-facing document by the report builders, not just hidden in UI.
    audience        text NOT NULL DEFAULT 'client'
                    CHECK (audience IN ('client', 'agent', 'both')),

    benefit_type    text NOT NULL DEFAULT 'cash_rebate'
                    CHECK (benefit_type IN ('cash_rebate', 'referral_bonus', 'fee_waiver', 'rate_discount', 'other')),

    -- Ordered array of { min_loan, max_loan|null, amount?, percent? }. max_loan
    -- null = open-ended top tier. Boundaries are min-inclusive / max-INCLUSIVE;
    -- see resolveTier() in lib/insurance/promotions.ts, which is the one place
    -- that decides which tier a given loan falls in.
    benefit_tiers   jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- CaseType values from lib/types/insurance.ts ('Purchase', 'Refinancing', …).
    -- Empty array = applies to every case type.
    applies_to      text[] NOT NULL DEFAULT '{}',

    -- Which date the eligibility window is measured against. SCB's promo keys off
    -- SUBMISSION date ("only applicable for loan submit 3 Aug or after"), which is
    -- what makes the deadline actionable for an agent — a disbursement-based
    -- window would mean something quite different for the same dates.
    window_basis    text NOT NULL DEFAULT 'submission'
                    CHECK (window_basis IN ('submission', 'disbursement', 'acceptance')),

    starts_on       date,
    ends_on         date,            -- null = open-ended (rare; most promos expire)

    conditions      text[] NOT NULL DEFAULT '{}',   -- the bank's own caveats, kept verbatim
    clawback_years  integer,          -- e.g. 3 — matters to a FUTURE refinance of this loan

    -- "Rebate will be nett off purchase price for LTV computation" — a genuine
    -- change to the purchase engine's max-loan math. Stored and surfaced as a
    -- prominent note; deliberately NOT auto-applied to the regulated calculation.
    affects_ltv     boolean NOT NULL DEFAULT false,

    source_text     text,             -- the original pasted message, for provenance
    notes           text,             -- admin's own internal annotation

    status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('published', 'draft')),

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Every agent-facing read is "active promos, newest-ending first".
CREATE INDEX IF NOT EXISTS idx_bank_promotions_window ON bank_promotions (ends_on DESC);
CREATE INDEX IF NOT EXISTS idx_bank_promotions_bank   ON bank_promotions (bank);

CREATE TRIGGER trg_bank_promotions_touch
    BEFORE UPDATE ON bank_promotions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE bank_promotions IS 'Time-boxed bank promotions (client cash rebates + agent referral incentives), extracted from pasted bank messages and admin-reviewed before publishing.';
COMMENT ON COLUMN bank_promotions.audience IS 'client | agent | both — agent rows must never reach a client-facing document.';
COMMENT ON COLUMN bank_promotions.benefit_tiers IS 'Ordered [{min_loan, max_loan|null, amount?, percent?}]; boundaries min-inclusive/max-inclusive.';

-- RLS on, no client policies — same posture as the other insurance content
-- tables (knowledge, rates, news, calendar). All access goes through guarded
-- server routes so the audience filter can never be bypassed from the browser.
ALTER TABLE bank_promotions ENABLE ROW LEVEL SECURITY;
