// Server side of the rate master. publishBank() is the ONLY way packages are written:
// the bank's whole list, in one transaction, with permanent history.

import { createAdminClient } from '@/lib/supabase/admin'
import { deriveFirstYearRate } from '@/lib/insurance/rateSchedule'
import { invalidatePackagesCache } from '@/lib/insurance/ratesCache'
import { todaySgt } from '@/lib/insurance/promotions'
import { bankChanges, packageErrors, packageLabel } from '@/lib/insurance/rateUpdate'
import type { MortgagePackage, MortgagePackageInput } from '@/lib/types/rates'

export interface RateSource { banker?: string; received_on?: string; text?: string; file_path?: string; file_name?: string }
export class RateError extends Error {
    constructor(message: string, public status = 400) { super(message) }
}

const STALE = 'Someone else changed this bank since you opened it. Reload to get the latest, then make your changes again.'

export async function loadBank(bank: string): Promise<{ packages: MortgagePackage[]; stamp: string }> {
    const db = createAdminClient()
    // Stamp first: if a publish lands in between, the save is refused rather than lost.
    const stamp = await db.rpc('rate_bank_stamp', { p_bank: bank })
    if (stamp.error) throw new RateError(stamp.error.message, 500)
    const { data, error } = await db.from('mortgage_packages').select('*').eq('bank', bank).order('min_loan_size')
    if (error) throw new RateError(error.message, 500)
    return { packages: (data ?? []) as MortgagePackage[], stamp: stamp.data as string }
}

const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : null
const numOrNull = (v: unknown) => v == null || v === '' ? null : Number(v)
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/** Only known fields, trimmed, with the sort key and dates worked out here. */
export function cleanPackage(p: MortgagePackage, old: MortgagePackage | undefined, bank: string, today: string) {
    const row = {
        id: p.id, bank,
        property_type: p.property_type, category: p.category, min_loan_size: Number(p.min_loan_size),
        package_name: String(p.package_name ?? '').trim(), lockin_years: Number(p.lockin_years),
        rate_schedule: p.rate_schedule, first_year_rate: deriveFirstYearRate(p.rate_schedule ?? []),
        features: (p.features ?? []).map(f => String(f).trim()).filter(Boolean),
        subsidies: text(p.subsidies), remarks: text(p.remarks), min_loan_note: text(p.min_loan_note),
        status: p.status === 'draft' ? 'draft' as const : 'published' as const,
        priority_min_loan: numOrNull(p.priority_min_loan), restricted_to: text(p.restricted_to),
        valid_until: text(p.valid_until), product: text(p.product),
        confirmed_on: text(p.confirmed_on) ?? today, last_updated: today,
    }
    if (old) {
        const changed = bankChanges([old], [row as MortgagePackage]).some(c => c.type === 'changed')
        if (!changed) row.last_updated = old.last_updated
    }
    return row
}

export async function publishBank(args: {
    bank: string; stamp: string; packages: MortgagePackage[]; before: MortgagePackage[]
    summary: string; userId: string; source?: RateSource | null; restoredFrom?: string | null
}): Promise<{ id: string | null; changes: number }> {
    const { bank, stamp, packages, before } = args
    if (!Array.isArray(packages)) throw new RateError('Missing packages')
    const ids = packages.map(p => p.id)
    if (ids.some(id => typeof id !== 'string' || !UUID.test(id)) || new Set(ids).size !== ids.length) throw new RateError('A package has a missing or repeated id')
    const today = todaySgt()
    const old = new Map(before.map(p => [p.id, p]))
    const rows = packages.map(p => cleanPackage(p, old.get(p.id), bank, today))
    const bad = rows.flatMap(r => {
        // An old package with a gap must not stop the rest of the bank being updated.
        const was = old.get(r.id)
        if (was && !bankChanges([was], [r as MortgagePackage]).some(c => c.type === 'changed')) return []
        const errs = packageErrors(r as MortgagePackage)
        return errs.length ? [`${packageLabel(r as MortgagePackage)}: ${errs.join(', ')}`] : []
    })
    if (bad.length) throw new RateError(`Fix before publishing. ${bad.join(' · ')}`)
    const changes = bankChanges(before, rows as MortgagePackage[])
    if (!changes.length) return { id: null, changes: 0 }

    const { data, error } = await createAdminClient().rpc('publish_bank_rates', {
        p_bank: bank, p_stamp: stamp, p_packages: rows, p_summary: args.summary.slice(0, 300),
        p_changes: changes, p_source: args.source ?? null, p_user: args.userId, p_restored_from: args.restoredFrom ?? null,
    })
    if (error) throw error.message.includes('STALE_RATES') ? new RateError(STALE, 409) : new RateError(error.message, 500)
    invalidatePackagesCache()
    return { id: data as string, changes: changes.length }
}

/** One-package edits from the Rates page: same path, same history. */
export async function editBank(bank: string, userId: string, summary: string, edit: (ps: MortgagePackage[]) => MortgagePackage[]) {
    const { packages, stamp } = await loadBank(bank)
    return publishBank({ bank, stamp, packages: edit(packages), before: packages, summary, userId })
}

export function fromInput(input: MortgagePackageInput, id: string, old?: MortgagePackage): MortgagePackage {
    return {
        ...(old ?? { first_year_rate: null, last_updated: todaySgt(), confirmed_on: todaySgt() }),
        ...input,
        id, bank: old?.bank ?? input.bank,
        subsidies: input.subsidies ?? null, remarks: input.remarks ?? null, min_loan_note: input.min_loan_note ?? null,
        status: input.status ?? 'published',
    } as MortgagePackage
}

export async function findPackage(id: string): Promise<MortgagePackage> {
    const { data, error } = await createAdminClient().from('mortgage_packages').select('*').eq('id', id).maybeSingle()
    if (error) throw new RateError(error.message, 500)
    if (!data) throw new RateError('Package not found', 404)
    return data as MortgagePackage
}

export function rateErrorResponse(e: unknown): Response {
    const status = e instanceof RateError ? e.status : 500
    if (status === 500) console.error('[rates]', e)
    return Response.json({ error: e instanceof Error ? e.message : 'Something went wrong' }, { status })
}
