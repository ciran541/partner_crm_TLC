'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getSafeRoute } from '@/lib/permissions'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import { History, User, Calendar } from 'lucide-react'

interface AuditEntry {
    id: string
    action: string
    target_type: string | null
    target_id: string | null
    details: Record<string, unknown>
    created_at: string
    actor: { name: string | null } | null
}

const ACTION_LABELS: Record<string, string> = {
    user_created: 'User created',
    user_updated: 'User updated',
    password_reset: 'Password reset',
    invite_created: 'Invite created',
    invite_revoked: 'Invite revoked',
}

export default function AuditLogPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [entries, setEntries] = useState<AuditEntry[]>([])
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        checkAdminAndLoad()
    }, [])

    const checkAdminAndLoad = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.replace('/login'); return }

        const { data: profile } = await supabase.from('profiles').select('role, app_type').eq('id', user.id).single()
        if (!profile || !['admin', 'super_admin'].includes(profile.role)) {
            router.replace(getSafeRoute(profile?.role, profile?.app_type))
            return
        }
        await loadEntries()
    }

    const loadEntries = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/admin/audit-log')
            if (res.ok) {
                setEntries(await res.json())
            } else {
                setError('Failed to load audit log.')
            }
        } catch {
            setError('An unexpected error occurred.')
        }
        setLoading(false)
    }

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <Spinner size="md" color="#8b5cf6" label="Loading audit log…" />
        </div>
    )

    return (
        <div className="space-y-6">
            {error && <InlineAlert type="error" message={error} onDismiss={() => setError(null)} />}

            <div>
                <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                    <History size={28} className="text-[#8b5cf6]" />
                    <span>Audit Log</span>
                </h1>
                <p className="text-slate-500 text-sm mt-1">Admin actions — user creation, updates, password resets, and invites. Most recent 200 shown.</p>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">When</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Admin</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Action</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Details</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {entries.map((entry) => (
                                <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-slate-400 text-xs whitespace-nowrap">
                                            <Calendar size={14} />
                                            <span>{new Date(entry.created_at).toLocaleString()}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-sm text-slate-700">
                                            <User size={14} className="text-slate-400" />
                                            <span>{entry.actor?.name ?? 'Unknown'}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-100">
                                            {ACTION_LABELS[entry.action] ?? entry.action}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <code className="text-xs text-slate-500 break-all">
                                            {Object.keys(entry.details ?? {}).length > 0 ? JSON.stringify(entry.details) : '—'}
                                        </code>
                                    </td>
                                </tr>
                            ))}
                            {entries.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="p-8 text-center text-slate-400 text-sm">No admin actions recorded yet.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
