-- Performance indexes for the insurance CRM's two hottest tables.
--
-- cases: every non-admin RLS check on cases (`created_by = auth.uid() OR
-- is_admin_user()`, on SELECT/INSERT/UPDATE) and every agent-filtered query
-- scans on created_by with no index today — only the workflow_data GIN index
-- exists (20260530000000). stage/case_type are the primary pipeline/reporting
-- dimensions across the dashboard and admin views.
--
-- profiles: role/app_type drive is_admin_user() and every canAccessInsurance/
-- canAccessProperty check — currently zero indexes on this table at all.

CREATE INDEX IF NOT EXISTS idx_cases_created_by ON public.cases (created_by);
CREATE INDEX IF NOT EXISTS idx_cases_stage ON public.cases (stage);
CREATE INDEX IF NOT EXISTS idx_cases_case_type ON public.cases (case_type);

CREATE INDEX IF NOT EXISTS idx_profiles_app_type_role ON public.profiles (app_type, role);
