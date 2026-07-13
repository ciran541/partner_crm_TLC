-- Referential integrity for the insurance side of the schema (+ shared profiles),
-- matching patterns already used elsewhere (phase1_property_platform.sql FKs
-- person-reference columns to auth.users; cases.stage/commission_status already
-- have CHECK constraints — this brings the remaining columns up to the same bar).
--
-- Scope: insurance-only tables + profiles. property_* is intentionally untouched.
--
-- Every ADD CONSTRAINT below is guarded by a pg_constraint existence check and
-- skipped (not re-created) if already present — the reference schema dump
-- (supabase/schema/full_current_schema.sql) turned out to be stale relative to
-- the live DB (user_consents_user_id_fkey already existed there, undocumented),
-- so this migration no longer assumes the dump is a complete/current picture.

-- ── Foreign keys on person-reference columns ──────────────────────────────
-- These were declared as bare `uuid` with no REFERENCES — unlike property's
-- equivalent actor_id/agent_id/uploaded_by columns, which correctly FK to
-- auth.users(id). ON DELETE RESTRICT matches that existing property convention:
-- there is no user-deletion flow today (accounts are disabled, not deleted), so
-- this only guards against ever silently orphaning history/content if one is
-- added later.

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'insurance_calendar_events_agent_id_fkey'
        AND conrelid = 'public.insurance_calendar_events'::regclass
    ) THEN
        ALTER TABLE public.insurance_calendar_events
            ADD CONSTRAINT insurance_calendar_events_agent_id_fkey
            FOREIGN KEY (agent_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'insurance_case_activity_logs_actor_id_fkey'
        AND conrelid = 'public.insurance_case_activity_logs'::regclass
    ) THEN
        ALTER TABLE public.insurance_case_activity_logs
            ADD CONSTRAINT insurance_case_activity_logs_actor_id_fkey
            FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'knowledge_articles_created_by_fkey'
        AND conrelid = 'public.knowledge_articles'::regclass
    ) THEN
        ALTER TABLE public.knowledge_articles
            ADD CONSTRAINT knowledge_articles_created_by_fkey
            FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'knowledge_gaps_asked_by_fkey'
        AND conrelid = 'public.knowledge_gaps'::regclass
    ) THEN
        ALTER TABLE public.knowledge_gaps
            ADD CONSTRAINT knowledge_gaps_asked_by_fkey
            FOREIGN KEY (asked_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_consents_user_id_fkey'
        AND conrelid = 'public.user_consents'::regclass
    ) THEN
        ALTER TABLE public.user_consents
            ADD CONSTRAINT user_consents_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- ── CHECK constraints on text columns that are really fixed enums ─────────
-- Mirrors property_case_type / property_case_status / property_commission_status
-- (real Postgres ENUMs) — kept as CHECK here rather than converting to ENUM to
-- avoid a type-conversion migration on live data; the validation guarantee is
-- the same. Value sets taken from the current TS types (lib/types/*.ts) —
-- keep these in sync if a case type, role, or status is ever added/removed.

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'cases_case_type_check' AND conrelid = 'public.cases'::regclass
    ) THEN
        ALTER TABLE public.cases
            ADD CONSTRAINT cases_case_type_check CHECK (case_type IN (
                'Refinancing', 'Purchase', 'Decouple', 'Equity Loan', 'Divorce'
            ));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_role_check' AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_role_check CHECK (role IN ('agent', 'admin', 'super_admin'));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_app_type_check' AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_app_type_check CHECK (app_type IN ('insurance', 'property'));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'profiles_status_check' AND conrelid = 'public.profiles'::regclass
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_status_check CHECK (status IN ('active', 'disabled'));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'mortgage_packages_status_check' AND conrelid = 'public.mortgage_packages'::regclass
    ) THEN
        ALTER TABLE public.mortgage_packages
            ADD CONSTRAINT mortgage_packages_status_check CHECK (status IN ('published', 'draft'));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'mortgage_packages_category_check' AND conrelid = 'public.mortgage_packages'::regclass
    ) THEN
        ALTER TABLE public.mortgage_packages
            ADD CONSTRAINT mortgage_packages_category_check CHECK (category IN (
                'Fixed', 'Floating (Completed)', 'BUC'
            ));
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'knowledge_articles_status_check' AND conrelid = 'public.knowledge_articles'::regclass
    ) THEN
        ALTER TABLE public.knowledge_articles
            ADD CONSTRAINT knowledge_articles_status_check CHECK (status IN ('published', 'draft'));
    END IF;
END $$;

-- knowledge_articles.category and mortgage_news_articles.category are
-- intentionally left unconstrained — both are genuinely open-ended,
-- admin-extensible free text (lib/types/knowledge.ts: `category: string`),
-- not a fixed set like the columns above.
