-- New top-level tab (not part of Resources): monthly "house view" research
-- reports banks publish as PDFs (OCBC's Research Monitor, UOB's Monthly
-- Investment Insights, etc.). Discovery is automated (each bank's research
-- listing page is scraped for new PDF links — see lib/insurance/bankIntelligence.ts),
-- and a comprehensive summary is extracted from the PDF itself via Gemini
-- (document understanding, not just text — these reports are table-heavy).
-- Extraction is automatic but publishing to agents is admin-gated: is_published
-- stays false until an admin reviews the AI-generated summary, same caution
-- already applied to rate-sheet ingestion elsewhere in this app.

CREATE TABLE IF NOT EXISTS bank_intelligence_reports (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank                  text NOT NULL,   -- display name, e.g. 'OCBC'
    bank_key              text NOT NULL,   -- stable key matching BANK_SOURCES in lib/types/bankIntelligence.ts
    title                 text NOT NULL,   -- e.g. 'Research Monitor (July)'
    report_period         date NOT NULL,   -- first-of-month the report covers, for grouping/sorting
    published_date        date,            -- the bank's own stated publish date, when available
    pdf_url               text NOT NULL,
    summary               text,            -- AI-extracted comprehensive summary; null until extracted
    summary_generated_at  timestamptz,
    extraction_error      text,            -- last extraction failure reason, if any (cleared on success)
    is_published           boolean NOT NULL DEFAULT false,  -- admin review gate — never auto-shown to agents
    hidden                boolean NOT NULL DEFAULT false,
    is_manual             boolean NOT NULL DEFAULT false,  -- admin QA addition; not part of the required ingestion path
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pdf_url)
);

CREATE INDEX IF NOT EXISTS idx_bank_intel_period ON bank_intelligence_reports (report_period DESC);

COMMENT ON TABLE bank_intelligence_reports IS 'Bank house-view research PDFs (OCBC, UOB, ...), auto-discovered + Gemini-summarized, admin-reviewed before publishing to agents.';

-- RLS on; all access via service-role server routes (cron writes, agents/admins read via API).
ALTER TABLE bank_intelligence_reports ENABLE ROW LEVEL SECURITY;
