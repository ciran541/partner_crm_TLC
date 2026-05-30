-- Workflow Engine: add workflow_data JSONB and Closed Lost fields to cases table

ALTER TABLE cases ADD COLUMN IF NOT EXISTS workflow_data JSONB DEFAULT '{}';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS closed_lost_reason TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS closed_lost_notes TEXT;

COMMENT ON COLUMN cases.workflow_data IS 'Per-case-type workflow answers stored as JSONB. Structure differs by case_type (RefinancingWorkflow, PurchaseWorkflow, etc.)';
COMMENT ON COLUMN cases.closed_lost_reason IS 'Required reason when stage is set to Closed Lost';
COMMENT ON COLUMN cases.closed_lost_notes IS 'Optional additional notes for Closed Lost';
