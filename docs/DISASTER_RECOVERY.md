# Disaster Recovery Guide

> Use this guide if the Supabase project is lost, corrupted, or needs to be migrated to a new project.
> All case data is mirrored to Google Sheets and all documents to Google Drive in real-time.

---

## What Is Backed Up

| Data | Where | Recovery |
|------|-------|----------|
| All property cases (34 fields) | Google Sheets → "Property Cases" tab | Automated via `restoreToApp()` |
| Agent profiles | Google Sheets → "Agent Profiles" tab | Automated via `restoreAgents()` |
| Uploaded documents (PDFs) | Google Drive → `Property CRM Backup/Cases/` | Manual re-upload |
| Database schema | `supabase/schema/full_current_schema.sql` | Run in SQL Editor |
| Activity logs | ❌ Not backed up | Audit trail only — not restorable |
| Reminders | ❌ Not backed up | Regenerate from lock-in dates |

---

## Prerequisites

Before starting, confirm you have access to:

- [ ] Google account that owns the Apps Script Web App and the backup Google Sheet
- [ ] The `APPS_SCRIPT_SECRET` value (stored in Vercel environment variables or `.env.local`)
- [ ] The Apps Script Web App URL (`GOOGLE_APPS_SCRIPT_URL`)
- [ ] This repository (for the schema SQL file)
- [ ] Vercel account (to update environment variables after creating new Supabase project)

---

## Step 1 — Create New Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New Project**
2. Choose a region close to your users
3. Save the **database password** somewhere safe
4. Wait for the project to finish provisioning (~2 minutes)
5. Copy the new **Project URL** and **anon key** from Settings → API

---

## Step 2 — Restore the Database Schema

1. In the new Supabase project, open **SQL Editor**
2. Open `supabase/schema/full_current_schema.sql` from this repository
3. Copy the entire file contents
4. Paste into SQL Editor → click **Run**
5. If prompted about RLS: click **"Run without RLS"** (the script sets up RLS separately)

This creates all tables, enums, foreign keys, indexes, and RLS policies — the full structure of the original database.

---

## Step 3 — Update Environment Variables

Update these values everywhere they are used:

### In Vercel (production)
Go to Vercel → Your Project → Settings → Environment Variables and update:

```
NEXT_PUBLIC_SUPABASE_URL        ← new project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   ← new anon key
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

## Step 7 — Restore Documents (Manual)

Documents are stored in Google Drive under:
```
Property CRM Backup/
  └── Cases/
       └── {Client Name} — {case-id}/
            └── document.pdf
```

To re-link documents:
1. Open the app → navigate to each case
2. Re-upload the relevant documents from the Google Drive folder
3. The app will store the new Supabase Storage URLs and resume normal operation

> Document re-upload is the only manual step in the entire restore process.

---

## Step 8 — Verify the Restore

Run through this checklist to confirm everything is working:

- [ ] Log in as admin — can see all cases in the case list
- [ ] Open a specific case — all fields are populated correctly
- [ ] Each case is assigned to the correct agent (check Agent Name)
- [ ] Log in as an agent — can see only their own cases
- [ ] Create a new case — it appears in Google Sheets within seconds
- [ ] Upload a document — it appears in Google Drive within seconds
- [ ] Agent profile data (full name, mobile, CEA number) is correct

---

## Estimated Recovery Time

| Step | Time |
|------|------|
| New Supabase project | ~5 minutes |
| Schema restore | ~2 minutes |
| Env vars + redeploy | ~5 minutes |
| Case restore (100 cases) | ~1 minute |
| Agent re-registration | depends on agents |
| Agent UUID re-map | ~1 minute |
| Document re-upload | varies |
| **Total (excluding agents)** | **~15 minutes** |

---

## Keeping the Schema Backup Current

The file `supabase/schema/full_current_schema.sql` must be updated whenever the database structure changes (new columns, new tables, new enums).

**When to update it:**
- After running any migration that adds/removes columns or tables
- After adding new enum values in Supabase

**How to update it:**
1. Open Supabase SQL Editor on the live project
2. Run the introspection queries used to generate the original file (see git history of `full_current_schema.sql`)
3. Replace the file contents with the new output
4. Commit to the repository

---

## Contacts / Ownership

| Resource | Location |
|----------|----------|
| Backup Google Sheet | Check `GOOGLE_APPS_SCRIPT_URL` env var for the script, then open the parent spreadsheet |
| Google Drive backup | Google Drive → `Property CRM Backup/` |
| Apps Script | Google Sheet → Extensions → Apps Script |
| Schema file | `supabase/schema/full_current_schema.sql` |
| Restore endpoints | `app/api/admin/property/restore-from-sheets/route.ts`, `app/api/admin/property/restore-agents/route.ts` |
