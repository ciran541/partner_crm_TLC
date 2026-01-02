'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Profile, CreateUserInput, UpdateUserInput } from '@/lib/types'
import { Plus, Search, Edit2, User, Shield, Mail, Calendar, X, Save, Lock } from 'lucide-react'

export default function UserManagementPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [profiles, setProfiles] = useState<Profile[]>([])
    const [searchQuery, setSearchQuery] = useState('')

    // Modal States
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isEditOpen, setIsEditOpen] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Form States
    const [createForm, setCreateForm] = useState<CreateUserInput>({
        email: '',
        name: '',
        role: 'agent',
        password: '' // Temporary pass
    })

    const [editForm, setEditForm] = useState<UpdateUserInput>({
        id: '',
        name: '',
        role: 'agent'
    })

    useEffect(() => {
        checkAdminAndLoad()
    }, [])

    const checkAdminAndLoad = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
            router.replace('/login')
            return
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profile?.role !== 'admin') {
            router.replace('/dashboard')
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
                alert('Failed to load profiles')
            }
        } catch (error) {
            console.error(error)
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
                body: JSON.stringify(createForm)
            })

            const data = await res.json()

            if (!res.ok) {
                alert(data.error || 'Failed to create user')
            } else {
                alert('User created successfully.')
                setIsCreateOpen(false)
                setCreateForm({ email: '', name: '', role: 'agent', password: '' }) // Reset
                loadProfiles()
            }
        } catch (error) {
            alert('An error occurred')
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
                body: JSON.stringify(editForm)
            })

            const data = await res.json()

            if (!res.ok) {
                alert(data.error || 'Failed to update user')
            } else {
                alert('User updated successfully.')
                setIsEditOpen(false)
                loadProfiles()
            }
        } catch (error) {
            alert('An error occurred')
        }
        setIsSubmitting(false)
    }

    const filteredProfiles = profiles.filter(p =>
        (p.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        (p.email?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    )

    if (loading) return <div style={{ padding: 40, color: '#052d4a' }}>Loading users...</div>

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#052d4a] flex items-center gap-2">
                        <User size={28} className="text-[#03a9e7]" />
                        <span>User Management</span>
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Manage partner agents and administrators.</p>
                </div>
                <button
                    onClick={() => setIsCreateOpen(true)}
                    className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                    <Plus size={18} />
                    <span>Add User</span>
                </button>
            </div>

            {/* Toolbar */}
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
                    Total Users: <span className="font-bold text-slate-900">{profiles.length}</span>
                </div>
            </div>

            {/* Users Table */}
            <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Name</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Email</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Role</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest">Created At</th>
                                <th className="p-4 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredProfiles.map((p) => (
                                <tr key={p.id} className="hover:bg-slate-50 transition-colors group">
                                    <td className="p-4">
                                        <div className={`font-semibold ${p.name ? 'text-slate-900' : 'text-slate-400 italic'}`}>
                                            {p.name || 'Unnamed User'}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2 text-slate-600 text-sm">
                                            <Mail size={14} className="text-slate-400" />
                                            <span>{p.email}</span>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${p.role === 'admin'
                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                : 'bg-sky-50 text-sky-700 border border-sky-100'
                                            }`}>
                                            {p.role === 'admin' && <Shield size={12} />}
                                            {p.role}
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
                                            className="p-2 text-slate-400 hover:text-[#03a9e7] hover:bg-sky-50 rounded-lg transition-all"
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
                            <input
                                required
                                type="text"
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all text-sm"
                                value={createForm.name}
                                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email Address</label>
                            <input
                                required
                                type="email"
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all text-sm"
                                value={createForm.email}
                                onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">System Role</label>
                            <select
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all text-sm bg-white"
                                value={createForm.role}
                                onChange={e => setCreateForm({ ...createForm, role: e.target.value as any })}
                            >
                                <option value="agent">Agent</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Temporary Password</label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    required
                                    type="text"
                                    className="w-full p-2.5 pl-10 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all text-sm"
                                    value={createForm.password}
                                    onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                                    placeholder="Set a dedicated password"
                                />
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">User can change this later or Admin can reset.</p>
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button type="button" onClick={() => setIsCreateOpen(false)} className="btn-outline px-6 py-2">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="btn-primary px-6 py-2">
                                {isSubmitting ? 'Creating...' : 'Create User'}
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
                            <input
                                required
                                type="text"
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all text-sm"
                                value={editForm.name || ''}
                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">System Role</label>
                            <select
                                className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 transition-all text-sm bg-white"
                                value={editForm.role}
                                onChange={e => setEditForm({ ...editForm, role: e.target.value as any })}
                            >
                                <option value="agent">Agent</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button type="button" onClick={() => setIsEditOpen(false)} className="btn-outline px-6 py-2">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="btn-primary px-6 py-2">
                                {isSubmitting ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}
        </div>
    )
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[100] bg-[#052d4a]/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h3 className="text-lg font-bold text-[#052d4a]">{title}</h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors text-slate-400">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6">
                    {children}
                </div>
            </div>
        </div>
    )
}
