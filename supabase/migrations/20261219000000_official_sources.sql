-- Official sources for Knowledge (agreed 2026-11-27).
--
-- Admins approve SITES, then the PAGES (sections) of them HUB may read. A daily
-- job reads each page when due, notices when its rules text changes, and writes
-- short draft answers in TLC's own words. Nothing from the page itself is kept:
-- only a fingerprint to spot changes. Drafts are ordinary knowledge_articles
-- that an admin approves; when a page changes, its articles go back to draft
-- (source_changed_at) until an admin checks them again.

CREATE TABLE IF NOT EXISTS public.official_sites (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain       text NOT NULL UNIQUE CHECK (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$'),
    name         text NOT NULL CHECK (btrim(name) <> ''),
    -- false: the site's terms don't allow automated reading; admins read it by hand.
    bots_allowed boolean NOT NULL DEFAULT true,
    note         text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.official_pages (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id           uuid NOT NULL REFERENCES public.official_sites(id) ON DELETE CASCADE,
    url               text NOT NULL UNIQUE CHECK (url ~ '^https://'),
    section           text NOT NULL DEFAULT '',
    title             text,
    check_days        integer NOT NULL DEFAULT 30 CHECK (check_days BETWEEN 1 AND 365),
    -- new: never read · ok · changed: rules text changed, articles waiting for a re-check
    -- failed: couldn't read it · blocked: the site's robots.txt or settings say no
    status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'ok', 'changed', 'failed', 'blocked')),
    fingerprint       text,
    checked_at        timestamptz,
    changed_at        timestamptz,
    drafts_written_at timestamptz,
    error             text,
    fail_count        integer NOT NULL DEFAULT 0,
    created_by        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS official_pages_site_idx ON public.official_pages(site_id);

ALTER TABLE public.knowledge_articles
    ADD COLUMN IF NOT EXISTS official_page_id  uuid REFERENCES public.official_pages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source_changed_at timestamptz;
CREATE INDEX IF NOT EXISTS knowledge_articles_official_page_idx ON public.knowledge_articles(official_page_id) WHERE official_page_id IS NOT NULL;

-- Content tables: RLS on, no client policies; all access through admin routes.
ALTER TABLE public.official_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_pages ENABLE ROW LEVEL SECURITY;

-- Tier A to start. CPF's terms bar bots for commercial use: read by hand.
INSERT INTO public.official_sites (domain, name, bots_allowed, note) VALUES
    ('iras.gov.sg', 'IRAS', true,  'Stamp duty (BSD, ABSD, SSD)'),
    ('hdb.gov.sg',  'HDB',  true,  'HDB loans, eligibility, MOP'),
    ('mas.gov.sg',  'MAS',  true,  'TDSR, MSR, LTV, tenure'),
    ('cpf.gov.sg',  'CPF',  false, 'Terms bar bots for commercial use: an admin reads CPF pages and writes the articles by hand')
ON CONFLICT (domain) DO NOTHING;

-- First pages, weekly for the high-risk rules, monthly for the rest.
INSERT INTO public.official_pages (site_id, url, section, check_days)
SELECT s.id, p.url, p.section, p.days
FROM (VALUES
    ('iras.gov.sg', 'https://www.iras.gov.sg/taxes/stamp-duty/for-property/buying-or-acquiring-property/buyer%27s-stamp-duty-(bsd)', 'Stamp duty: BSD', 7),
    ('iras.gov.sg', 'https://www.iras.gov.sg/taxes/stamp-duty/for-property/buying-or-acquiring-property/additional-buyer%27s-stamp-duty-(absd)', 'Stamp duty: ABSD', 7),
    ('iras.gov.sg', 'https://www.iras.gov.sg/taxes/stamp-duty/for-property/selling-or-disposing-property/seller%27s-stamp-duty-(ssd)-for-residential-property', 'Stamp duty: SSD', 7),
    ('mas.gov.sg',  'https://www.mas.gov.sg/regulation/explainers/new-housing-loans/loan-tenure-and-loan-to-value-limits', 'Loan tenure and LTV', 7),
    ('mas.gov.sg',  'https://www.mas.gov.sg/regulation/explainers/new-housing-loans/msr-and-tdsr-rules', 'MSR and TDSR', 7),
    ('hdb.gov.sg',  'https://www.hdb.gov.sg/buying-a-flat/flat-grant-and-loan-eligibility/housing-loan/housing-loan-from-hdb', 'HDB housing loan', 30),
    ('hdb.gov.sg',  'https://www.hdb.gov.sg/buying-a-flat/flat-grant-and-loan-eligibility/housing-loan/housing-loan-from-financial-institutions', 'Bank loan for HDB flats', 30)
) AS p(domain, url, section, days)
JOIN public.official_sites s ON s.domain = p.domain
ON CONFLICT (url) DO NOTHING;
