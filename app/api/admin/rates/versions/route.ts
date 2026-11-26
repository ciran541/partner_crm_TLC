import { NextResponse } from 'next/server'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadBank, publishBank, rateErrorResponse, type RateSource } from '@/lib/insurance/rateMaster'
import { packageErrors } from '@/lib/insurance/rateUpdate'
import type { MortgagePackage } from '@/lib/types/rates'

// GET ?source=<version id>  opens the original PDF/screenshot of a version.
export async function GET(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    const id = new URL(request.url).searchParams.get('source') ?? ''
    const db = createAdminClient()
    const { data } = await db.from('rate_versions').select('source').eq('id', id).maybeSingle()
    const path = (data?.source as RateSource | null)?.file_path
    if (!path) return NextResponse.json({ error: 'No file for this update' }, { status: 404 })
    const signed = await db.storage.from('rate-sources').createSignedUrl(path, 300)
    if (!signed.data) return NextResponse.json({ error: 'The file could not be opened' }, { status: 404 })
    return NextResponse.redirect(signed.data.signedUrl)
}

// POST { versionId, stamp }  puts the bank back to how it was BEFORE that update.
export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const { versionId, stamp } = await request.json().catch(() => ({}))
        const { data: v, error } = await createAdminClient().from('rate_versions').select('id, bank, summary, packages_before, created_at').eq('id', versionId ?? '').maybeSingle()
        if (error || !v) return NextResponse.json({ error: 'That version was not found' }, { status: 404 })
        const { packages: before } = await loadBank(v.bank)
        const packages = v.packages_before as MortgagePackage[]
        const broken = packages.filter(p => packageErrors(p).length)
        if (broken.length) return NextResponse.json({ error: `That version has packages that no longer pass the checks: ${broken.map(p => p.package_name).join(', ')}` }, { status: 400 })
        const result = await publishBank({
            bank: v.bank, stamp, packages, before, userId: auth.userId, restoredFrom: v.id,
            summary: `Restored to before "${v.summary}" (${v.created_at.slice(0, 10)})`,
        })
        return NextResponse.json(result)
    } catch (e) { return rateErrorResponse(e) }
}
