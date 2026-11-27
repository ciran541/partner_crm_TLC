-- Letter of Offer uploads: 25 MB a file on both apps.
--
-- 20260710000000 capped both document buckets at 10 MB, so Basic & Starter's
-- uploader (which allows 25 MB) was refused by storage above 10 MB, and
-- Premium's LO reader now uploads to storage first instead of sending the file
-- through Vercel (~4.5 MB request limit).
--
-- Premium also accepts WebP pages (LO_ACCEPTED_MIME), which the bucket refused
-- on confirm.
UPDATE storage.buckets
SET file_size_limit = 26214400 -- 25 MB
WHERE id IN ('property-documents', 'insurance-documents');

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
WHERE id = 'insurance-documents';
