-- Banks' Insights: our own copy of reports whose source URL is overwritten in
-- place. UOB's "FX, Interest Rates & Commodities Forecasts" always lives at the
-- same address (FX_Int_Rate.pdf) and is replaced with each new edition (~every
-- 6 weeks), so without a copy an older summary's "Original PDF" link would open
-- whichever edition is current, not the one that was summarized.
--
-- Private bucket on purpose: these are the bank's copyrighted PDFs, so they are
-- served only to logged-in users through /api/insurance/bank-intelligence/archive
-- (service role reads the bucket; no client storage policies).

ALTER TABLE bank_intelligence_reports ADD COLUMN IF NOT EXISTS archive_path text;

COMMENT ON COLUMN bank_intelligence_reports.archive_path IS
    'Path in the private bank-research storage bucket when we keep our own copy (source overwritten in place, e.g. UOB FX_Int_Rate.pdf). Null = link straight to pdf_url.';

INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-research', 'bank-research', false)
ON CONFLICT (id) DO NOTHING;
