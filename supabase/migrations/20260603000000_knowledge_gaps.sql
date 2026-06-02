-- Knowledge gap capture: log questions the knowledge base couldn't answer,
-- so admin sees what expertise is missing and can write it.

CREATE TABLE IF NOT EXISTS knowledge_gaps (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question    text NOT NULL,
    asked_by    uuid,
    status      text NOT NULL DEFAULT 'open',   -- 'open' | 'resolved'
    created_at  timestamptz DEFAULT now()
);

COMMENT ON TABLE knowledge_gaps IS 'Unanswered agent questions (no relevant knowledge_articles matched). Drives the admin authoring backlog.';

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_status ON knowledge_gaps (status, created_at DESC);

-- RLS on; all access via server routes (service-role), like knowledge_articles.
ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
