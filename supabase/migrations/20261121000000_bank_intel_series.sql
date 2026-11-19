-- Banks' Insights: a bank can now be watched for more than one kind of report
-- (OCBC: the monthly Research Monitor plus its SORA and Central Banks Outlook
-- notes from the FX & Rates page). `series` says which watch rule found a row,
-- so agents can tell three OCBC items in the same month apart.
-- Null = a bank with a single report type (UOB/HSBC/Maybank/SC/DBS today) or a
-- manual admin addition.

ALTER TABLE bank_intelligence_reports ADD COLUMN IF NOT EXISTS series text;

COMMENT ON COLUMN bank_intelligence_reports.series IS
    'Which watch rule found this report, e.g. ''Research Monitor'', ''SORA'', ''Central Banks Outlook''. Null for single-series banks and manual rows.';

-- Every OCBC row before this migration came from the Monthly Monitor rule.
-- Labelling them also tells discovery that series already has history, so it
-- does not re-scan every month back to July 2026 for it on each run.
UPDATE bank_intelligence_reports
SET series = 'Research Monitor'
WHERE bank_key = 'ocbc' AND series IS NULL AND is_manual = false;
