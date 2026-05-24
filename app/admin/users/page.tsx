'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getSafeRoute } from '@/lib/permissions'
import { Profile, CreateUserInput, UpdateUserInput } from '@/lib/types/shared'
import Modal from '@/components/shared/Modal'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import { Plus, Search, Edit2, User, Shield, Mail, Calendar, Lock } from 'lucide-react'

export default function AdminUsersPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [profiles, setProfiles] = useState<Profile[]>([])
    const [searchQuery, setSearchQuery] = useState('')

    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isEditOpen, setIsEditOpen] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [pageAlert, setPageAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    const [createForm, setCreateForm] = useState<CreateUserInput>({
        email: '',
        name: '',
        role: 'agent',
        app_type: 'insurance',
        password: '',
    })

    const [editForm, setEditForm] = useState<UpdateUserInput>({ id: '', name: '', role: 'agent' })

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
        await loadProfiles()
    }

    const loadProfiles = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/admin/get-profiles')
            if (res.ok) {
                const data = await res.json()
                setProfiles(data)
            } else {
                setPageAlert({ type: 'error', message: 'Failed to load profiles.' })
            }
        } catch (error) {
            console.error(error)
            setPageAlert({ type: 'error', message: 'An unexpected error occurred.' })
        }
        setLoading(false)
    }

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        try {
            const res = await fetch('/api/admin/create-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(createForm),
            })
            const data = await res.json()
            if (!res.ok) {
                setPageAlert({ type: 'error', message: data.error || 'Failed to create user.' })
            } else {
                setIsCreateOpen(false)
                setCreateForm({ email: '', name: '', role: 'agent', app_type: 'insurance', password: '' })
                setPageAlert({ type: 'success', message: 'User created successfully.' })
                loadProfiles()
            }
        } catch {
            setPageAlert({ type: 'error', message: 'An unexpected error occurred.' })
        }
        setIsSubmitting(false)
    }

    const handleEditUser = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        try {
            const res = await fetch('/api/admin/update-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editForm),
            })
            const data = await res.json()
            if (!res.ok) {
                setPageAlert({ type: 'error', message: data.error || 'Failed to update user.' })
            } else {
                setIsEditOpen(false)
                setPageAlert({ type: 'success', message: 'User updated successfully.' })
                loadProfiles()
            }
        } catch {
            setPageAlert({ type: 'error', message: 'An unexpected error occurred.' })
        }
        setIsSubmitting(false)
    }

    const filteredProfiles = profiles.filter(
        (p) =>
            (p.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (p.email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    )

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0' }}>
            <Spinner size="md" color="#8b5cf6" label="Loading users…" />
        </div>
    )

    return (
        <div className="space-y-6">
            {pageAlert && (
                <InlineAlert
                    type={pageAlert.type}
                    message={pageAlert.message}
                    onDismiss={() => setPageAlert(null)}
                />
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <User size={28} className="text-[#8b5cf6]" />
                        <span>User Management</span>
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Manage all agents and administrators across all domains.</p>
                </div>
                <button
                    onClick={() => setIsCreateOpen(true)}
                    className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                    <Plus size={18} />
                    <span>Add User</span>
                </button>
            </div>

            <div className="card p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="relative flex-1 group">
                    <Search size={16} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-[#03a9e7] transition-colors" />
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full p-2.5 pl-10 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all"
                    />
                </div>
                <div className="text-sm text-slate-500 whitespace-nowrap">
                    Total: <span className="font-bold text-slate-900">{profiles.length}</span>
                </div>
            </div>

            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Name</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Email</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Role</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Domain</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Created</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredProfiles.map((p) => (
                                <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <span style={{
                                                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                                background: p.status === 'disabled' ? '#ef4444' : '#22c55e',
                                            }} />
                                            <span className={`font-semibold ${p.name ? 'text-slate-900' : 'text-slate-400 italic'}`}>
                                                {p.name || 'Unnamed User'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-slate-600 text-sm">
                                            <Mail size={14} className="text-slate-400" />
                                            <span>{p.email}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                                            ['admin','super_admin'].includes(p.role)
                                                ? 'bg-purple-50 text-purple-700 border border-purple-100'
                                                : 'bg-sky-50 text-sky-700 border border-sky-100'
                                        }`}>
                                            {['admin','super_admin'].includes(p.role) && <Shield size={10} className="shrink-0" />}
                                            {p.role}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            p.app_type === 'property'
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-sky-50 text-sky-700'
                                        }`}>
                                            {p.app_type ?? 'insurance'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                                            p.status === 'disabled'
                                                ? 'bg-red-50 text-red-600 border border-red-100'
                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                        }`}>
                                            {p.status ?? 'active'}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-slate-400 text-xs">
                                            <Calendar size={14} />
                                            <span>{new Date(p.created_at).toLocaleDateString()}</span>
                                        </div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <button
                                            onClick={() => {
                                                setEditForm({ id: p.id, name: p.name || '', role: p.role })
                                                setIsEditOpen(true)
                                            }}
                                            className="p-2 text-slate-400 hover:text-[#8b5cf6] hover:bg-purple-50 rounded-lg transition-all"
                                            title="Edit User"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Modal */}
            {isCreateOpen && (
                <Modal title="Add New User" onClose={() => setIsCreateOpen(false)}>
                    <form onSubmit={handleCreateUser} className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Full Name</label>
                            <input required type="text"
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm"
                                value={createForm.name}
                                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email Address</label>
                            <input required type="email"
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm"
                                value={createForm.email}
                                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Domain</label>
                            <select className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm bg-white"
                                value={createForm.app_type ?? 'insurance'}
                                onChange={(e) => setCreateForm({ ...createForm, app_type: e.target.value as any })}>
                                <option value="insurance">Insurance</option>
                                <option value="property">Property</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Role</label>
                            <select className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm bg-white"
                                value={createForm.role}
                                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as any })}>
                                <option value="agent">Agent</option>
                                <option value="super_admin">Super Admin</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Temporary Password</label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input required type="text"
                                    className="w-full p-2.5 pl-10 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm"
                                    value={createForm.password ?? ''}
                                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                                    placeholder="Set a temporary password" />
                            </div>
                            <p className="mt-1 text-xs text-slate-400">The user should change this after first login.</p>
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button type="button" onClick={() => setIsCreateOpen(false)} className="btn-ghost px-6 py-2">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="btn-primary px-6 py-2 flex items-center gap-2">
                                {isSubmitting ? <Spinner size="sm" color="white" label="Creating…" /> : 'Create User'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Edit Modal */}
            {isEditOpen && (
                <Modal title="Edit User" onClose={() => setIsEditOpen(false)}>
                    <form onSubmit={handleEditUser} className="space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Full Name</label>
                            <input required type="text"
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm"
                                value={editForm.name || ''}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Role</label>
                            <select className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm bg-white"
                                value={editForm.role}
                                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as any })}>
                                <option value="agent">Agent</option>
                                <option value="super_admin">Super Admin</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                            <select className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm bg-white"
                                value={editForm.status ?? 'active'}
                                onChange={(e) => setEditForm({ ...editForm, status: e.target.value as any })}>
                                <option value="active">Active</option>
                                <option value="disabled">Disabled</option>
                            </select>
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button type="button" onClick={() => setIsEditOpen(false)} className="btn-ghost px-6 py-2">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="btn-primary px-6 py-2 flex items-center gap-2">
                                {isSubmitting ? <Spinner size="sm" color="white" label="Saving…" /> : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    )
}
