# Disaster Recovery Guide

> Use this guide if the Supabase project is lost, corrupted, or needs to be migrated to a new project.
> The **primary backup** is a full daily database dump stored in Cloudflare R2
> (see `docs/BACKUP_SETUP.md`), which also mirrors the documents bucket. There is
> a separate daily Drive mirror of documents (`/api/cron/drive-sync`) for ops to
> browse — that is a convenience copy, not the disaster-recovery source.

---

## What Is Backed Up

| Data | Where | Recovery |
|------|-------|----------|
| **Entire database** (all tables, exact IDs/types) | Cloudflare R2 → `db/<year>/<month>/backup_*.tar.gz` (daily) | **Primary** — restore via `pg_restore`/`psql` (Part A below) |
| Activity logs, reminders, knowledge, rates, commissions | included in the R2 dump | restored with the database |
| Agent login accounts | `auth.sql` inside the R2 dump | optional — restore to skip re-registration |
| Uploaded documents (PDFs) | Cloudflare R2 → `documents/` (daily copy of the Storage bucket) | Restore via `rclone`/`aws s3` (Part A) |
| Database schema | also in `supabase/migrations/` | `supabase db push` |
| Property cases + agent profiles (ops view) | Google Sheets | **Legacy fallback** — Part B below |
| Documents (browsable copy) | Google Drive → `Property CRM` / `Insurance CRM` folders (daily, `/api/cron/drive-sync`) | Convenience only — not a restore path, see note below |

> The Google Sheet + Apps Script path (Part B) still works and is kept as a
> fallback, but the R2 dump is the source of truth: it captures **everything**
> (logs, reminders, exact UUIDs), not just 34 case fields.

---

## Part A — Restore from the R2 dump (primary)

Use this whenever the database is lost or you're moving to a new project.

### A1. Create a new Supabase project
Same as Step 1 below — note the new **Project Ref** and **database password**.

### A2. Download the latest backup
From the Cloudflare R2 bucket, grab the newest `db/<year>/<month>/backup_*.tar.gz`, then:

```bash
tar -xzf backup_<timestamp>.tar.gz
# yields: roles.sql  schema.sql  data.sql  auth.sql
```

### A3. Restore into the new project
Use the new project's **Session pooler** connection string (port 5432):

```bash
DB="postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"

psql "$DB" -f roles.sql       # (skip errors for roles that already exist)
psql "$DB" -f schema.sql      # tables, types, functions, RLS
psql "$DB" -f data.sql        # all row data — same IDs as before
```

That brings back **all application data** — cases, commissions, activity logs,
reminders, knowledge, rates — with original IDs and foreign keys intact.

### A4. (Optional) Restore agent logins to skip re-registration
```bash
psql "$DB" -f auth.sql        # restores auth.users with original UUIDs
```
If this restores cleanly, agents keep their accounts and you can **skip Steps 5–6**.
If it errors (auth schema conflicts), don't fight it — fall back to the
re-registration + UUID re-map in **Steps 5–6** below, which always works.

### A5. Finish
- Update env vars + redeploy → **Step 3** below.
- Restore document PDFs from R2 → **Step 7** below.
- Verify → **Step 8** below.

> ⚠️ **A backup you haven't restored isn't a backup.** Do one test restore into a
> throwaway Supabase project after setup, and re-test after any major schema change.

---

## Part B — Restore from Google Sheets (legacy fallback)

Steps 1–8 below are the original Google Sheets / Apps Script procedure. Use it
only if the R2 dump is unavailable. It recovers the 34 case fields + agent
profiles, but **not** activity logs or reminders.

---

## Prerequisites

Before starting, confirm you have access to:

- [ ] Google account that owns the Apps Script Web App and the backup Google Sheet
- [ ] The `APPS_SCRIPT_SECRET` value (stored in Vercel environment variables or `.env.local`)
- [ ] The Apps Script Web App URL (`GOOGLE_APPS_SCRIPT_URL`)
- [ ] This repository (cloned locally, with Supabase CLI installed)
- [ ] Vercel account (to update environment variables after creating new Supabase project)

---

## Step 1 — Create New Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Choose a region close to your users
3. Save the **database password** somewhere safe
4. Wait for the project to finish provisioning (~2 minutes)
5. Copy the new **Project Reference ID** from Settings → General

---

## Step 2 — Restore the Database Schema

The entire schema is tracked as migration files in `supabase/migrations/`. One command recreates all tables, enums, and foreign keys on the new project.

```bash
# Link your local repo to the new Supabase project
npx supabase link --project-ref <new-project-ref>

# Apply all migrations — recreates the full DB structure
npx supabase db push
```

That's it. All tables, columns, enums, and foreign keys are created automatically in the correct order.

> **No Docker required.** `supabase db push` connects directly via the connection pooler — no local Supabase stack needed.

---

## Step 3 — Update Environment Variables

Update these values everywhere they are used:

### In Vercel (production)
Go to Vercel → Your Project → Settings → Environment Variables and update:

```
NEXT_PUBLIC_SUPABASE_URL        ← new project URL (Settings → API)
NEXT_PUBLIC_SUPABASE_ANON_KEY   ← new anon key (Settings → API)
SUPABASE_SERVICE_ROLE_KEY       ← new service role key (Settings → API → service_role)
```

Keep these unchanged (they belong to Google, not Supabase):
```
GOOGLE_APPS_SCRIPT_URL          ← unchanged
APPS_SCRIPT_SECRET              ← unchanged
```

### In `.env.local` (local development)
Update the same three Supabase keys in your local `.env.local` file.

After updating Vercel, **redeploy** the app so the new keys take effect.

---

## Step 4 — Restore All Cases from Google Sheets

1. Open the backup Google Sheet
2. Click **Extensions → Apps Script**
3. Open the `Code.gs` file
4. Confirm `APP_URL` in the `restoreToApp()` function points to your current production domain:
   ```js
   var APP_URL = 'https://your-app.vercel.app/api/admin/property/restore-from-sheets';
   ```
5. Select `restoreToApp` in the function dropdown → click **Run**
6. Check the **Execution log** — you should see batch results like:
   ```
   Batch 1: {"inserted":50,"updated":0,"errors":0,"total":50}
   Batch 2: {"inserted":32,"updated":0,"errors":0,"total":32}
   Restore complete. Total cases: 82
   ```

> If you see `Unauthorized` errors, verify `SECRET` in Code.gs matches `APPS_SCRIPT_SECRET` in Vercel.

---

## Step 5 — Re-register Agents

Agents must sign up again using the **same email addresses** they used before. This is how the system re-links their cases to them automatically.

1. Send agents a link to the app registration page
2. Ask each agent to sign up using their original email address
3. Wait until all (or most) agents have re-registered before running Step 6

> You can run Step 6 multiple times — agents who haven't re-registered yet are skipped safely and marked `not_registered`. Run again after they sign up.

---

## Step 6 — Auto Re-map Agent UUIDs

When a new Supabase project is created, every agent gets a new UUID. Cases in the restored database still reference the old UUIDs. This step re-links everything automatically using email as the matching key.

1. Open Apps Script editor (same sheet as Step 4)
2. Confirm `APP_URL` in `restoreAgents()` points to your production domain:
   ```js
   var APP_URL = 'https://your-app.vercel.app/api/admin/property/restore-agents';
   ```
3. Select `restoreAgents` in the function dropdown → click **Run**
4. Check the **Execution log**:
   ```
   === Agent Restore Summary ===
   Remapped:        12
   Already matched: 0
   Not registered:  2   (run again after they sign up)
   Errors:          0
   ```

Repeat this step after any remaining agents re-register.

---

## Step 7 — Restore Documents (from R2)

The PDFs are backed up daily to Cloudflare R2 under `documents/`. Restore them by
copying that folder back into the **new** project's Supabase Storage bucket
(`property-documents`). Because `data.sql` already restored the
`property_case_documents` rows (with the same file paths), the documents re-link
automatically — no manual per-case re-upload.

```bash
# Configure rclone remotes for R2 (source) and the NEW Supabase Storage (dest),
# then copy the whole documents folder back:
rclone copy R2:<bucket>/documents NEWSUPA:property-documents --fast-list -v
```

> The remote configs are the same S3 settings as the backup (see
> `docs/BACKUP_SETUP.md`); `NEWSUPA` uses the **new** project's Storage S3 keys.

---

## Step 8 — Verify the Restore

Run through this checklist to confirm everything is working:

- [ ] Log in as admin — can see all cases in the case list
- [ ] Open a specific case — all fields are populated correctly
- [ ] Each case is assigned to the correct agent (check Agent Name)
- [ ] Log in as an agent — can see only their own cases
- [ ] Create a new case — it appears in Google Sheets within seconds
- [ ] Upload a document — it is stored in Supabase Storage (and copied to R2, and to Drive, on the next daily backup runs)
- [ ] Agent profile data (full name, mobile, CEA number) is correct

---

## Estimated Recovery Time

| Step | Time |
|------|------|
| New Supabase project | ~5 minutes |
| Schema restore (`supabase db push`) | ~1 minute |
| Env vars + redeploy | ~5 minutes |
| Case restore (100 cases) | ~1 minute |
| Agent re-registration | depends on agents |
| Agent UUID re-map | ~1 minute |
| Document re-upload | varies |
| **Total (excluding agents)** | **~13 minutes** |

---

## Making DB Changes Going Forward

**Always use migrations — never change the DB directly in Supabase SQL Editor.**

```bash
# 1. Create a new migration file
npx supabase migration new describe_your_change

# 2. Write your SQL in the generated file
#    supabase/migrations/<timestamp>_describe_your_change.sql

# 3. Push it to the live DB
npx supabase db push

# 4. Commit the migration file to git
git add supabase/migrations/
git commit -m "add migration: describe your change"
```

This keeps the `supabase/migrations/` folder and the live DB permanently in sync. Any future DB restore is just `supabase link` + `supabase db push`.

> If you ever make a change directly in SQL Editor by mistake, run `npm run sync-schema` to capture the current state, then manually create a migration file from the diff so the repo stays accurate.

---

## Contacts / Ownership

| Resource | Location |
|----------|----------|
| Backup Google Sheet | Check `GOOGLE_APPS_SCRIPT_URL` env var for the script, then open the parent spreadsheet |
| Drive document mirror (ops browsing, not DR) | Folder ID in `GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID` → `Property CRM` / `Insurance CRM` subfolders |
| Apps Script | Google Sheet → Extensions → Apps Script |
| Migration files | `supabase/migrations/` |
| Restore endpoints | `app/api/admin/property/restore-from-sheets/route.ts`, `app/api/admin/property/restore-agents/route.ts` |
