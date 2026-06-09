# Database Backup Setup (one-time)

> Automated daily backup of the whole Supabase database to **Cloudflare R2**.
> Runs via the GitHub Action in `.github/workflows/db-backup.yml`.
> To **restore**, see `docs/DISASTER_RECOVERY.md`.

## What this does

Once a day a GitHub Action backs up **two things** to a Cloudflare R2 bucket
(R2 lives outside Supabase, so backups survive even if the Supabase project is
deleted):

1. **The whole database** — a complete logical dump (every table, every row,
   exact types and IDs) as one compressed archive under `db/`.
2. **All uploaded PDFs** — the Supabase Storage `property-documents` bucket is
   copied to `documents/` (additive copy — never deletes from the backup).

The old **Google Drive** document mirror has been **retired** — R2 now holds the
PDFs too, so everything is in one place.

The Google Sheet is now **ops/reporting only**. It is no longer the backup.

---

## Step 1 — Create a Cloudflare R2 bucket

1. Sign up / log in at <https://dash.cloudflare.com> → **R2**.
   (R2 has a free tier: 10 GB storage + free downloads — far more than these
   small dumps will ever need.)
2. **Create bucket** → name it e.g. `partner-crm-backups`. Region: Automatic.
3. Note the bucket name.

## Step 2 — Create an R2 API token

1. R2 → **Manage R2 API Tokens** → **Create API Token**.
2. Permissions: **Object Read & Write**, scoped to your bucket.
3. Create, then copy:
   - **Access Key ID**
   - **Secret Access Key**  (shown once — copy it now)
   - **Endpoint** for S3 clients — looks like
     `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

## Step 3 — Get the Supabase connection string

In the Supabase dashboard → **Connect** (top bar) → **Session pooler**.

Copy that URI. It looks like:

```
postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

> ⚠️ **Use the _Session pooler_ string (port `5432`).**
> - The **Direct connection** is IPv6-only and won't work from GitHub Actions.
> - The **Transaction pooler** (port `6543`) is incompatible with `pg_dump`.
>
> Replace `<PASSWORD>` with your database password.

## Step 4 — Get Supabase Storage S3 keys (for the PDFs)

This lets the backup copy the uploaded PDF documents to R2.

1. Supabase dashboard → **Project Settings → Storage** → **S3 Connection**.
2. Note the **Endpoint** (e.g. `https://<ref>.storage.supabase.co/storage/v1/s3`)
   and the **Region** (e.g. `ap-southeast-1`).
3. Click **New access key** → copy the **Access Key ID** and **Secret Access Key**.

## Step 5 — Add the secrets to GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add all nine:

| Secret name                     | Value                                                          |
|---------------------------------|----------------------------------------------------------------|
| `SUPABASE_DB_URL`               | the Session pooler URI from Step 3 (with the real password)    |
| `R2_ACCESS_KEY_ID`              | R2 Access Key ID (Step 2)                                      |
| `R2_SECRET_ACCESS_KEY`          | R2 Secret Access Key (Step 2)                                  |
| `R2_ENDPOINT`                   | R2 S3 endpoint, e.g. `https://<acct>.r2.cloudflarestorage.com` |
| `R2_BUCKET`                     | bucket name, e.g. `partner-crm-backups`                        |
| `SUPABASE_S3_ENDPOINT`          | Storage S3 endpoint (Step 4)                                   |
| `SUPABASE_S3_REGION`            | Storage region, e.g. `ap-southeast-1` (Step 4)                 |
| `SUPABASE_S3_ACCESS_KEY_ID`     | Storage S3 Access Key ID (Step 4)                              |
| `SUPABASE_S3_SECRET_ACCESS_KEY` | Storage S3 Secret Access Key (Step 4)                          |

## Step 6 — Test it now

1. Repo → **Actions** → **Daily DB Backup** → **Run workflow**.
2. Watch both jobs go green:
   - **database** ends with `✅ Uploaded s3://.../db/YYYY/MM/backup_*.tar.gz`
   - **documents** ends with `✅ Documents synced to ...`
3. In Cloudflare R2, open the bucket and confirm you see both a `db/` archive and
   the PDFs under `documents/`.

If it fails, the most common cause is the wrong connection string (the DB job
needs the **Session pooler**, port 5432) or a missing/typo'd secret.

---

## Optional — auto-delete old backups

Dumps are tiny, but to cap storage: R2 bucket → **Settings → Object lifecycle
rules** → add a rule to delete objects older than e.g. **90 days**. One-time
setup, then it self-prunes.

## How it runs

- **Schedule:** daily at 02:30 SGT (`30 18 * * *` UTC) — see the workflow file.
- **Manual:** Actions tab → Run workflow (use for testing or an ad-hoc backup).
- DB dumps land under `db/<year>/<month>/backup_<timestamp>.tar.gz`.
- PDFs land under `documents/` (mirrors the Supabase Storage bucket).
