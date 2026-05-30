-- GIN index on workflow_data for efficient JSONB queries
-- (e.g. querying by completed_steps, flags, or specific step data)
CREATE INDEX IF NOT EXISTS idx_cases_workflow_data ON cases USING GIN (workflow_data);

COMMENT ON COLUMN cases.workflow_data IS 'v2 (10-step): RefinancingWorkflow structured data. See lib/types/workflow.ts for schema.';
