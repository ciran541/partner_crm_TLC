-- =============================================================
-- Full schema export — TLC_CRM (umkewxijcnlljqohmsyi)
-- Exported: 2026-05-26
-- Includes: all tables, enums, foreign keys as of this date
-- RLS policies and triggers: see phase1_property_platform.sql
-- =============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ENUMS
-- =============================================================

CREATE TYPE public.property_case_status AS ENUM (
    'draft', 'submitted', 'under_review', 'verified',
    'closed_won', 'closed_lost', 'on_hold', 'opportunity_due',
    'paid', 'rejected'
);

CREATE TYPE public.property_case_type AS ENUM (
    'new_purchase', 'refinance', 'decoupling', 'equity'
);

CREATE TYPE public.property_commission_status AS ENUM (
    'pending', 'confirmed', 'paid'
);

CREATE TYPE public.reminder_type AS ENUM (
    'lockin_90_day'
);

-- =============================================================
-- TABLES
-- =============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL,
    name text,
    role text DEFAULT 'agent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    app_type text DEFAULT 'insurance'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    full_name text,
    mobile text,
    cea_registration_no text,
    agency_name text,
    joined_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.banks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 99 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid NOT NULL,
    stage text DEFAULT 'Touched Base'::text NOT NULL,
    case_type text NOT NULL,
    client_name text,
    client_mobile text,
    client_email text,
    loan_size numeric,
    property_type text,
    property_price numeric,
    current_bank text,
    existing_loan_amount numeric,
    lock_in_end_date date,
    closed_package_details text,
    closed_interest_rate numeric,
    closed_tenure integer,
    subsidy_provided text,
    clawback_end_date date,
    remarks text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.property_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id uuid NOT NULL,
    case_type property_case_type NOT NULL,
    status property_case_status DEFAULT 'draft'::property_case_status NOT NULL,
    client_name text NOT NULL,
    client_mobile text NOT NULL,
    client_email text,
    property_address text,
    bank_id uuid,
    interest_rate numeric(6,4),
    balance_tenure_months integer,
    outstanding_loan_amount numeric(15,2),
    subsidy_amount numeric(15,2),
    lockin_confirmed_date date,
    gross_commission_amount numeric(15,2),
    agent_commission_amount numeric(15,2),
    tlc_commission_amount numeric(15,2),
    commission_status property_commission_status DEFAULT 'pending'::property_commission_status NOT NULL,
    projected_remaining_balance numeric(15,2),
    projected_gross_commission numeric(15,2),
    projected_agent_income numeric(15,2),
    projected_tlc_income numeric(15,2),
    actual_recurring_gross numeric(15,2),
    actual_recurring_agent_income numeric(15,2),
    actual_recurring_tlc_income numeric(15,2),
    recurring_converted boolean DEFAULT false NOT NULL,
    is_duplicate boolean DEFAULT false NOT NULL,
    duplicate_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Added after initial migration:
    followup_preference text,
    follow_up_date date,
    followup_completed_at timestamp with time zone,
    lock_in_period integer
);

CREATE TABLE IF NOT EXISTS public.property_case_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    file_url text NOT NULL,
    file_name text NOT NULL,
    file_type text NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.property_case_activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    action text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.property_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id uuid NOT NULL,
    reminder_type reminder_type DEFAULT 'lockin_90_day'::reminder_type NOT NULL,
    trigger_date date NOT NULL,
    is_sent boolean DEFAULT false NOT NULL,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.user_consents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    terms_accepted boolean DEFAULT false NOT NULL,
    privacy_accepted boolean DEFAULT false NOT NULL,
    terms_version text DEFAULT '1.0'::text NOT NULL,
    privacy_version text DEFAULT '1.0'::text NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- =============================================================
-- FOREIGN KEYS
-- =============================================================

ALTER TABLE public.cases
    ADD CONSTRAINT cases_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles (id);

ALTER TABLE public.property_cases
    ADD CONSTRAINT property_cases_bank_id_fkey
    FOREIGN KEY (bank_id) REFERENCES public.banks (id);

ALTER TABLE public.property_case_documents
    ADD CONSTRAINT property_case_documents_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES public.property_cases (id);

ALTER TABLE public.property_case_activity_logs
    ADD CONSTRAINT property_case_activity_logs_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES public.property_cases (id);

ALTER TABLE public.property_reminders
    ADD CONSTRAINT property_reminders_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES public.property_cases (id);

-- =============================================================
-- RLS POLICIES & TRIGGERS
-- See: supabase/migrations/phase1_property_platform.sql
-- Re-apply that file after running this schema on a new project.
-- =============================================================
