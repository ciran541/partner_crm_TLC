-- Rate management: HUB is the master for bank rates.
-- Additive: existing package ids and columns stay, so Step 4, the Rates page and
-- frozen client snapshots keep working.

ALTER TABLE public.mortgage_packages
    ADD COLUMN IF NOT EXISTS priority_min_loan numeric,
    ADD COLUMN IF NOT EXISTS restricted_to text,
    ADD COLUMN IF NOT EXISTS valid_until date,
    ADD COLUMN IF NOT EXISTS confirmed_on date,
    ADD COLUMN IF NOT EXISTS product text;

COMMENT ON COLUMN public.mortgage_packages.priority_min_loan IS 'Lower minimum loan for clients with Priority status at this bank.';
COMMENT ON COLUMN public.mortgage_packages.restricted_to IS 'Programme needed to take this package at all (Premier, Citigold…). NULL = everyone.';
COMMENT ON COLUMN public.mortgage_packages.product IS 'Overrides the automatic product (ladder) grouping.';

UPDATE public.mortgage_packages SET confirmed_on = last_updated WHERE confirmed_on IS NULL;

-- Notes that limit who can take the package at all.
UPDATE public.mortgage_packages SET restricted_to = btrim(min_loan_note)
WHERE restricted_to IS NULL AND min_loan_note IS NOT NULL
  AND min_loan_note ~* '(\monly\M|aum|premier|treasures|citigold|private client)'
  AND min_loan_note !~* 'min\s*\$?\d';

-- Notes that give a lower minimum: "Priority Banking: min $300K", "Funding Requirement: min $600K".
UPDATE public.mortgage_packages p SET priority_min_loan = m.n * CASE lower(m.unit) WHEN 'm' THEN 1000000 WHEN 'k' THEN 1000 ELSE 1 END
FROM (
    SELECT id, (r)[1]::numeric AS n, coalesce((r)[2], '') AS unit
    FROM (SELECT id, regexp_match(min_loan_note, 'min\s*\$?(\d+(?:\.\d+)?)\s*([KkMm])?') AS r
          FROM public.mortgage_packages WHERE min_loan_note ~* '(priority|privilege|premier|funding)') x
    WHERE r IS NOT NULL
) m
WHERE m.id = p.id AND p.priority_min_loan IS NULL;

-- One permanent row per publish of a bank.
CREATE TABLE IF NOT EXISTS public.rate_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank            text NOT NULL,
    summary         text NOT NULL,
    source          jsonb,          -- {banker, received_on, text, file_path, file_name}
    changes         jsonb NOT NULL DEFAULT '[]',
    packages_before jsonb NOT NULL,
    packages_after  jsonb NOT NULL,
    restored_from   uuid REFERENCES public.rate_versions(id),
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_versions_bank ON public.rate_versions (bank, created_at DESC);

CREATE OR REPLACE FUNCTION public.rate_versions_are_permanent() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    RAISE EXCEPTION 'Rate history cannot be changed or deleted';
END $$;
DROP TRIGGER IF EXISTS rate_versions_permanent ON public.rate_versions;
CREATE TRIGGER rate_versions_permanent BEFORE UPDATE OR DELETE ON public.rate_versions
    FOR EACH ROW EXECUTE FUNCTION public.rate_versions_are_permanent();

-- Saved AI reads, so the same message is never paid for twice.
CREATE TABLE IF NOT EXISTS public.rate_message_reads (
    hash       text PRIMARY KEY,
    result     jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Remembered answers: "3y fixed" from this bank/banker means this product.
CREATE TABLE IF NOT EXISTS public.rate_aliases (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank       text NOT NULL,
    banker     text NOT NULL DEFAULT '',
    phrase     text NOT NULL,
    ladder_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (bank, banker, phrase)
);

-- Bank-wide notes agents see (e.g. SCB Priority Mortgage Plus).
CREATE TABLE IF NOT EXISTS public.bank_rate_notes (
    bank       text PRIMARY KEY,
    note       text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- All access goes through guarded server routes.
ALTER TABLE public.rate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_rate_notes ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public) VALUES ('rate-sources', 'rate-sources', false) ON CONFLICT (id) DO NOTHING;

-- Changes whenever any package of the bank changes; publishing checks it.
CREATE OR REPLACE FUNCTION public.rate_bank_stamp(p_bank text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT md5(coalesce(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), ''))
    FROM public.mortgage_packages p WHERE p.bank = p_bank
$$;

-- The only way rates are written: the bank's whole list, in one transaction, with history.
CREATE OR REPLACE FUNCTION public.publish_bank_rates(
    p_bank text, p_stamp text, p_packages jsonb, p_summary text, p_changes jsonb,
    p_source jsonb, p_user uuid, p_restored_from uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_before jsonb;
    v_after  jsonb;
    v_id     uuid;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('rates:' || p_bank));

    IF public.rate_bank_stamp(p_bank) IS DISTINCT FROM p_stamp THEN
        RAISE EXCEPTION 'STALE_RATES';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_packages) x
               JOIN public.mortgage_packages m ON m.id = (x->>'id')::uuid WHERE m.bank <> p_bank) THEN
        RAISE EXCEPTION 'A package belongs to another bank';
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') INTO v_before
    FROM public.mortgage_packages p WHERE p.bank = p_bank;

    DELETE FROM public.mortgage_packages p
    WHERE p.bank = p_bank
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_packages) x WHERE (x->>'id')::uuid = p.id);

    INSERT INTO public.mortgage_packages AS m (
        id, bank, property_type, category, min_loan_size, package_name, lockin_years, rate_schedule,
        first_year_rate, features, subsidies, remarks, min_loan_note, status, last_updated,
        priority_min_loan, restricted_to, valid_until, confirmed_on, product
    )
    SELECT
        (x->>'id')::uuid, p_bank, x->>'property_type', x->>'category', (x->>'min_loan_size')::numeric,
        x->>'package_name', (x->>'lockin_years')::int, x->'rate_schedule',
        (x->>'first_year_rate')::numeric, ARRAY(SELECT jsonb_array_elements_text(x->'features')),
        x->>'subsidies', x->>'remarks', x->>'min_loan_note', x->>'status', (x->>'last_updated')::date,
        (x->>'priority_min_loan')::numeric, x->>'restricted_to', (x->>'valid_until')::date,
        (x->>'confirmed_on')::date, x->>'product'
    FROM jsonb_array_elements(p_packages) x
    ON CONFLICT (id) DO UPDATE SET
        property_type = EXCLUDED.property_type, category = EXCLUDED.category,
        min_loan_size = EXCLUDED.min_loan_size, package_name = EXCLUDED.package_name,
        lockin_years = EXCLUDED.lockin_years, rate_schedule = EXCLUDED.rate_schedule,
        first_year_rate = EXCLUDED.first_year_rate, features = EXCLUDED.features,
        subsidies = EXCLUDED.subsidies, remarks = EXCLUDED.remarks, min_loan_note = EXCLUDED.min_loan_note,
        status = EXCLUDED.status, last_updated = EXCLUDED.last_updated,
        priority_min_loan = EXCLUDED.priority_min_loan, restricted_to = EXCLUDED.restricted_to,
        valid_until = EXCLUDED.valid_until, confirmed_on = EXCLUDED.confirmed_on, product = EXCLUDED.product
    WHERE (to_jsonb(m) - 'created_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(EXCLUDED) - 'created_at' - 'updated_at');

    SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]') INTO v_after
    FROM public.mortgage_packages p WHERE p.bank = p_bank;

    INSERT INTO public.rate_versions (bank, summary, source, changes, packages_before, packages_after, restored_from, created_by)
    VALUES (p_bank, p_summary, p_source, coalesce(p_changes, '[]'), v_before, v_after, p_restored_from, p_user)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.rate_bank_stamp(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_bank_rates(text, text, jsonb, text, jsonb, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_bank_stamp(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_bank_rates(text, text, jsonb, text, jsonb, jsonb, uuid, uuid) TO service_role;

-- replace_bank_packages() is left in place so the currently deployed site keeps
-- working until this release is live; drop it in a later migration.
