-- Allow deleting insurance cases.
--
-- The insurance `cases` table previously had no DELETE policy, so a client-side
-- delete was silently denied by RLS (Postgres returns success with 0 rows
-- affected). That made discarding a Mortgage Planner draft look like it "came
-- back" after a refresh.
--
-- An agent may delete their OWN cases; admins may delete any. This matches the
-- pattern used by property_cases (pc_delete).

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cases_delete" ON public.cases;

CREATE POLICY "cases_delete" ON public.cases
    FOR DELETE TO authenticated
    USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
        )
    );
