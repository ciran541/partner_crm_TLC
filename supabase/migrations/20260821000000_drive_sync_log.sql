-- Tracks which documents (from either app's Storage bucket) have already been
-- mirrored to the ops Google Drive backup folder, so the daily sync only
-- uploads what's new instead of re-uploading everything every run.
-- Accessed only server-side via the service-role admin client (like other
-- cron-owned tables), so RLS is enabled with no client policies.
CREATE TABLE IF NOT EXISTS public.drive_sync_log (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    app_type text NOT NULL CHECK (app_type IN ('property', 'insurance')),
    case_id uuid NOT NULL,
    storage_bucket text NOT NULL,
    storage_path text NOT NULL,
    drive_file_id text NOT NULL,
    synced_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (storage_bucket, storage_path)
);
ALTER TABLE public.drive_sync_log ENABLE ROW LEVEL SECURITY;
