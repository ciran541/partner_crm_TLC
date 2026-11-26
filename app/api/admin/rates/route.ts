import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdminUser } from '@/lib/auth/requireAdmin'
import { editBank, findPackage, fromInput, rateErrorResponse } from '@/lib/insurance/rateMaster'
import { packageLabel } from '@/lib/insurance/rateUpdate'
import type { MortgagePackageInput } from '@/lib/types/rates'

// Single-package edits. Every one goes through publishBank(), so it is in the history.
//   POST { input } | { duplicateId }   PATCH { id, input }   DELETE ?id=

export async function POST(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const body = await request.json().catch(() => ({}))
        const id = randomUUID()
        if (body?.duplicateId) {
            const orig = await findPackage(body.duplicateId)
            const copy = { ...orig, id, package_name: `${orig.package_name} (Copy)`, status: 'draft' as const }
            await editBank(orig.bank, auth.userId, `Duplicated ${packageLabel(orig)}`, ps => [...ps, copy])
        } else {
            const input = body?.input as MortgagePackageInput | undefined
            if (!input?.bank || !input?.package_name) return NextResponse.json({ error: 'Bank and package name are required' }, { status: 400 })
            const pkg = fromInput(input, id)
            await editBank(pkg.bank, auth.userId, `Added ${packageLabel(pkg)}`, ps => [...ps, pkg])
        }
        return NextResponse.json({ data: await findPackage(id) })
    } catch (e) { return rateErrorResponse(e) }
}

export async function PATCH(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const { id, input } = await request.json().catch(() => ({})) as { id?: string; input?: MortgagePackageInput }
        if (!id || !input) return NextResponse.json({ error: 'Missing id or input' }, { status: 400 })
        const old = await findPackage(id)
        if (input.bank !== old.bank) return NextResponse.json({ error: 'A package can\'t move to another bank. Create it there instead.' }, { status: 400 })
        await editBank(old.bank, auth.userId, `Edited ${packageLabel(old)}`, ps => ps.map(p => p.id === id ? fromInput(input, id, p) : p))
        return NextResponse.json({ data: await findPackage(id) })
    } catch (e) { return rateErrorResponse(e) }
}

export async function DELETE(request: Request) {
    const auth = await requireAdminUser()
    if (!auth.authorized) return auth.response
    try {
        const id = new URL(request.url).searchParams.get('id')
        if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
        const old = await findPackage(id)
        await editBank(old.bank, auth.userId, `Removed ${packageLabel(old)}`, ps => ps.filter(p => p.id !== id))
        return NextResponse.json({ success: true })
    } catch (e) { return rateErrorResponse(e) }
}
