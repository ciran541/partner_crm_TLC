import { createAdminClient } from '@/lib/supabase/admin'
import type { ClosedWonData } from '@/lib/types/insurance'
import { getDriveClient, findOrCreateFolder, uploadFileToDrive, caseFolderName } from './driveSync'

// Same "respect a wall-clock budget, not just an item cap" reasoning as
// lib/insurance/news.ts's ingestAll(): a backlog of documents (first run, or
// a quiet week) can alone exceed the 60s serverless ceiling. Whatever isn't
// synced this run stays unsynced in drive_sync_log and picks up tomorrow —
// never lost, just deferred.
const RUN_TIME_BUDGET_MS = 45000

interface SyncSummary {
    synced: number
    failed: number
    skipped_budget: number
}

async function alreadySynced(
    admin: ReturnType<typeof createAdminClient>,
    bucket: string
): Promise<Set<string>> {
    const { data } = await admin
        .from('drive_sync_log')
        .select('storage_path')
        .eq('storage_bucket', bucket)
    return new Set((data ?? []).map(r => r.storage_path as string))
}

export async function runDriveSync(): Promise<{ property: SyncSummary; insurance: SyncSummary }> {
    const startedAt = Date.now()
    const withinBudget = () => Date.now() - startedAt < RUN_TIME_BUDGET_MS

    const admin = createAdminClient()
    const drive = getDriveClient()
    const rootId = process.env.GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID
    if (!rootId) throw new Error('Missing GOOGLE_DRIVE_BACKUP_ROOT_FOLDER_ID env var')

    // Folder ids are cached for the life of this run only — Drive has no
    // unique-name constraint, so re-listing per document would risk creating
    // duplicate case folders under concurrent/slow calls.
    const folderCache = new Map<string, string>()
    async function folderFor(name: string, parentId: string): Promise<string> {
        const key = `${parentId}/${name}`
        const cached = folderCache.get(key)
        if (cached) return cached
        const id = await findOrCreateFolder(drive, name, parentId)
        folderCache.set(key, id)
        return id
    }

    const propertyRootId = await folderFor('Property CRM', rootId)
    const insuranceRootId = await folderFor('Insurance CRM', rootId)

    const property = await syncPropertyDocuments(admin, drive, propertyRootId, folderFor, withinBudget)
    const insurance = await syncInsuranceDocuments(admin, drive, insuranceRootId, folderFor, withinBudget)

    return { property, insurance }
}

type AdminClient = ReturnType<typeof createAdminClient>
type DriveClient = ReturnType<typeof getDriveClient>
type FolderFor = (name: string, parentId: string) => Promise<string>

async function syncPropertyDocuments(
    admin: AdminClient,
    drive: DriveClient,
    rootId: string,
    folderFor: FolderFor,
    withinBudget: () => boolean
): Promise<SyncSummary> {
    const summary: SyncSummary = { synced: 0, failed: 0, skipped_budget: 0 }
    const bucket = 'property-documents'

    const { data: docs } = await admin
        .from('property_case_documents')
        .select('id, case_id, file_url, file_name, file_type, property_cases(client_name)')

    const synced = await alreadySynced(admin, bucket)
    const pending = (docs ?? []).filter(d => !synced.has(d.file_url as string))

    for (const doc of pending) {
        if (!withinBudget()) {
            summary.skipped_budget = pending.length - summary.synced - summary.failed
            break
        }
        try {
            const clientName = (doc as unknown as { property_cases: { client_name: string } | null }).property_cases?.client_name
            const folderId = await folderFor(caseFolderName(clientName, doc.case_id as string), rootId)

            const { data: bytes, error: downloadError } = await admin.storage
                .from(bucket)
                .download(doc.file_url as string)
            if (downloadError || !bytes) throw downloadError ?? new Error('empty download')

            const driveFileId = await uploadFileToDrive(
                drive, folderId, doc.file_name as string, (doc.file_type as string) || 'application/octet-stream', bytes
            )

            await admin.from('drive_sync_log').insert({
                app_type: 'property',
                case_id: doc.case_id,
                storage_bucket: bucket,
                storage_path: doc.file_url,
                drive_file_id: driveFileId,
            })
            summary.synced++
        } catch (err) {
            console.error('[drive-sync] property document failed', doc.id, err)
            summary.failed++
        }
    }

    return summary
}

async function syncInsuranceDocuments(
    admin: AdminClient,
    drive: DriveClient,
    rootId: string,
    folderFor: FolderFor,
    withinBudget: () => boolean
): Promise<SyncSummary> {
    const summary: SyncSummary = { synced: 0, failed: 0, skipped_budget: 0 }
    const bucket = 'insurance-documents'

    const { data: cases } = await admin
        .from('cases')
        .select('id, client_name, closed_won_data')
        .not('closed_won_data->lo_documents', 'is', null)

    const synced = await alreadySynced(admin, bucket)
    const pending = (cases ?? []).flatMap(c => {
        const lo = ((c.closed_won_data as ClosedWonData | null)?.lo_documents ?? [])
        return lo.filter(d => !synced.has(d.path)).map(d => ({ case: c, doc: d }))
    })

    for (const { case: c, doc } of pending) {
        if (!withinBudget()) {
            summary.skipped_budget = pending.length - summary.synced - summary.failed
            break
        }
        try {
            const folderId = await folderFor(caseFolderName(c.client_name, c.id as string), rootId)

            const { data: bytes, error: downloadError } = await admin.storage
                .from(bucket)
                .download(doc.path)
            if (downloadError || !bytes) throw downloadError ?? new Error('empty download')

            const driveFileId = await uploadFileToDrive(drive, folderId, doc.name, doc.type || 'application/octet-stream', bytes)

            await admin.from('drive_sync_log').insert({
                app_type: 'insurance',
                case_id: c.id,
                storage_bucket: bucket,
                storage_path: doc.path,
                drive_file_id: driveFileId,
            })
            summary.synced++
        } catch (err) {
            console.error('[drive-sync] insurance document failed', c.id, doc.path, err)
            summary.failed++
        }
    }

    return summary
}
