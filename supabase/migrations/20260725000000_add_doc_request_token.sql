-- Client document request: a shareable, unguessable token per case.
-- The agent generates it (on demand) to send the client a tailored, public
-- "documents to prepare" page. Nullable — only set once a checklist is shared.
-- No RLS policy needed: the token is resolved only by the public page's server
-- route via the service-role (admin) client, and cases RLS already blocks
-- client-side reads of other agents' cases.

ALTER TABLE cases ADD COLUMN IF NOT EXISTS doc_request_token uuid;

CREATE UNIQUE INDEX IF NOT EXISTS cases_doc_request_token_idx
    ON cases (doc_request_token)
    WHERE doc_request_token IS NOT NULL;
