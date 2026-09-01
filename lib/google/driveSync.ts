import { google } from 'googleapis'
import type { drive_v3 } from 'googleapis'
import { Readable } from 'stream'

/**
 * Ops backup mirror: daily copy of both apps' Storage buckets into a Google
 * Drive folder ops can browse without touching Supabase/S3 tooling. Reuses
 * the same service account as the TLC calendar sync (lib/google/oauth.ts) —
 * it just also needs the Drive API enabled on the GCP project, and the
 * backup root folder shared with the service account email as Editor.
 *
 * Full `drive` scope (not `drive.file`) because the root folder is created
 * and owned by a human ops account, merely shared with the service account —
 * `drive.file` would only see folders the service account itself created.
 */
export function getDriveClient(): drive_v3.Drive {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

    if (!clientEmail || !privateKey) {
        throw new Error(
            'Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars'
        )
    }

    const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/drive'],
    })

    return google.drive({ version: 'v3', auth })
}

/** Drive has no real path concept — folder names can collide, so callers must
 * cache ids themselves (see `folderCache` in the cron route) rather than
 * calling this per-document. */
export async function findOrCreateFolder(
    drive: drive_v3.Drive,
    name: string,
    parentId: string
): Promise<string> {
    const escaped = name.replace(/'/g, "\\'")
    const { data } = await drive.files.list({
        q: `name='${escaped}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
        spaces: 'drive',
    })

    const existing = data.files?.[0]?.id
    if (existing) return existing

    const { data: created } = await drive.files.create({
        requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id',
    })

    if (!created.id) throw new Error(`Drive did not return an id for folder "${name}"`)
    return created.id
}

export async function uploadFileToDrive(
    drive: drive_v3.Drive,
    parentId: string,
    name: string,
    mimeType: string,
    bytes: Blob
): Promise<string> {
    const buffer = Buffer.from(await bytes.arrayBuffer())
    const { data } = await drive.files.create({
        requestBody: { name, parents: [parentId] },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id',
    })

    if (!data.id) throw new Error(`Drive did not return an id for file "${name}"`)
    return data.id
}

/** Case-folder names are for humans browsing Drive — keep them readable but
 * strip characters that read oddly in a folder name. */
export function caseFolderName(clientName: string | null | undefined, caseId: string): string {
    const label = (clientName ?? 'Unnamed').replace(/[\\/]/g, '-').trim()
    return `${label} - ${caseId.slice(0, 8)}`
}
