'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { getSafeRoute } from '@/lib/permissions'
import { Profile, CreateUserInput, UpdateUserInput, AgentInvite } from '@/lib/types/shared'
import Modal from '@/components/shared/Modal'
import InlineAlert from '@/components/shared/InlineAlert'
import Spinner from '@/components/shared/Spinner'
import { Plus, Search, Edit2, User, Shield, Mail, Calendar, Lock, Link2, Copy, Ban, Check } from 'lucide-react'

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

    const [isResetOpen, setIsResetOpen] = useState(false)
    const [resetTarget, setResetTarget] = useState<{ id: string; name: string } | null>(null)
    const [resetPassword, setResetPassword] = useState('')

    const [invites, setInvites] = useState<AgentInvite[]>([])
    const [isInviteOpen, setIsInviteOpen] = useState(false)
    const [inviteForm, setInviteForm] = useState({ invited_name: '', invited_email: '' })
    const [generatedInviteUrl, setGeneratedInviteUrl] = useState<string | null>(null)
    const [generatedInviteEmailed, setGeneratedInviteEmailed] = useState(false)
    const [copied, setCopied] = useState(false)

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
        await Promise.all([loadProfiles(), loadInvites()])
    }

    const loadInvites = async () => {
        try {
            const res = await fetch('/api/admin/insurance/invites')
            if (res.ok) {
                setInvites(await res.json())
            }
        } catch (error) {
            console.error(error)
        }
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

    const handleCreateInvite = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsSubmitting(true)
        try {
            const res = await fetch('/api/admin/insurance/invites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(inviteForm),
            })
            const data = await res.json()
            if (!res.ok) {
                setPageAlert({ type: 'error', message: data.error || 'Failed to create invite.' })
            } else {
                setGeneratedInviteUrl(data.url)
                setGeneratedInviteEmailed(!!data.emailed)
                loadInvites()
            }
        } catch {
            setPageAlert({ type: 'error', message: 'An unexpected error occurred.' })
        }
        setIsSubmitting(false)
    }

    const handleRevokeInvite = async (id: string) => {
        try {
            const res = await fetch('/api/admin/insurance/invites', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status: 'revoked' }),
            })
            if (res.ok) {
                loadInvites()
            } else {
                setPageAlert({ type: 'error', message: 'Failed to revoke invite.' })
            }
        } catch {
            setPageAlert({ type: 'error', message: 'An unexpected error occurred.' })
        }
    }

    const copyInviteUrl = (url: string) => {
        navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    const closeInviteModal = () => {
        setIsInviteOpen(false)
        setInviteForm({ invited_name: '', invited_email: '' })
        setGeneratedInviteUrl(null)
        setGeneratedInviteEmailed(false)
        setCopied(false)
    }

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!resetTarget) return
        setIsSubmitting(true)
        try {
            const res = await fetch('/api/admin/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: resetTarget.id, password: resetPassword }),
            })
            const data = await res.json()
            if (!res.ok) {
                setPageAlert({ type: 'error', message: data.error || 'Failed to reset password.' })
            } else {
                setIsResetOpen(false)
                setResetPassword('')
                setResetTarget(null)
                setPageAlert({ type: 'success', message: `Password reset for ${resetTarget.name}.` })
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
                <div className="flex gap-2 w-full sm:w-auto">
                    <button
                        onClick={() => setIsInviteOpen(true)}
                        className="btn-ghost flex items-center justify-center gap-2 flex-1 sm:flex-none"
                    >
                        <Link2 size={18} />
                        <span>Invite Agent</span>
                    </button>
                    <button
                        onClick={() => setIsCreateOpen(true)}
                        className="btn-primary flex items-center justify-center gap-2 flex-1 sm:flex-none"
                    >
                        <Plus size={18} />
                        <span>Add User</span>
                    </button>
                </div>
            </div>

            {invites.filter(i => i.status === 'pending').length > 0 && (
                <div className="card p-4">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-3">
                        Pending Invites — sent, not yet signed up
                    </p>
                    <div className="space-y-2">
                        {invites.filter(i => i.status === 'pending').map(invite => (
                            <div key={invite.id} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-700 truncate">
                                        {invite.invited_name || invite.invited_email || 'Unnamed invite'}
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Expires {new Date(invite.expires_at).toLocaleDateString()}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        onClick={() => copyInviteUrl(`${window.location.origin}/insurance/signup?token=${invite.token}`)}
                                        className="p-2 text-slate-400 hover:text-[#03a9e7] hover:bg-sky-50 rounded-lg transition-all"
                                        title="Copy Link"
                                    >
                                        <Copy size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleRevokeInvite(invite.id)}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                        title="Revoke"
                                    >
                                        <Ban size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => {
                                                    setResetTarget({ id: p.id, name: p.name || p.email || 'User' })
                                                    setResetPassword('')
                                                    setIsResetOpen(true)
                                                }}
                                                className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                                title="Reset Password"
                                            >
                                                <Lock size={16} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditForm({ id: p.id, name: p.name || '', role: p.role, status: p.status ?? 'active' })
                                                    setIsEditOpen(true)
                                                }}
                                                className="p-2 text-slate-400 hover:text-[#8b5cf6] hover:bg-purple-50 rounded-lg transition-all"
                                                title="Edit User"
                                            >
                                                <Edit2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Invite Modal */}
            {isInviteOpen && (
                <Modal title="Invite Agent" onClose={closeInviteModal}>
                    {generatedInviteUrl ? (
                        <div className="space-y-4">
                            {generatedInviteEmailed ? (
                                <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                                    Emailed to the agent — no need to send it yourself. Keep the link below as a backup.
                                </p>
                            ) : (
                                <p className="text-sm text-slate-600">
                                    Send this link to the agent <span className="font-semibold">after payment is confirmed</span> —
                                    it's single-use and lets them sign up with their own email and password. Their account will
                                    be active as soon as they finish.
                                </p>
                            )}
                            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                                <input
                                    readOnly
                                    value={generatedInviteUrl}
                                    className="flex-1 min-w-0 bg-transparent text-xs text-slate-600 outline-none truncate"
                                />
                                <button
                                    type="button"
                                    onClick={() => copyInviteUrl(generatedInviteUrl)}
                                    className="shrink-0 px-3 py-1.5 rounded-md bg-[#03a9e7] hover:bg-[#0398d1] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                                >
                                    {copied ? <Check size={14} /> : <Copy size={14} />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                            <div className="flex justify-end pt-2 border-t border-slate-100">
                                <button type="button" onClick={closeInviteModal} className="btn-primary px-6 py-2">Done</button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleCreateInvite} className="space-y-4">
                            <p className="text-sm text-slate-600">
                                Only generate this after the agent has paid — the link itself is what activates their account.
                            </p>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Agent&apos;s Name (optional)</label>
                                <input type="text"
                                    className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm"
                                    value={inviteForm.invited_name}
                                    onChange={(e) => setInviteForm({ ...inviteForm, invited_name: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Agent&apos;s Email</label>
                                <input required type="email"
                                    className="w-full p-2.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-[#03a9e7]/20 text-sm"
                                    value={inviteForm.invited_email}
                                    onChange={(e) => setInviteForm({ ...inviteForm, invited_email: e.target.value })} />
                                <p className="mt-1 text-xs text-slate-400">Required — the invite only works for this exact email, even if the link is shared.</p>
                            </div>
                            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                                <button type="button" onClick={closeInviteModal} className="btn-ghost px-6 py-2">Cancel</button>
                                <button type="submit" disabled={isSubmitting} className="btn-primary px-6 py-2 flex items-center gap-2">
                                    {isSubmitting ? <Spinner size="sm" color="white" label="Generating…" /> : 'Generate Link'}
                                </button>
                            </div>
                        </form>
                    )}
                </Modal>
            )}

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
                        {(createForm.app_type ?? 'insurance') === 'insurance' ? (
                            <div className="p-3 rounded-lg bg-sky-50 border border-sky-100 text-xs text-sky-800">
                                A secure &quot;set your password&quot; link will be emailed to them automatically — no temporary password needed.
                            </div>
                        ) : (
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
                        )}
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button type="button" onClick={() => setIsCreateOpen(false)} className="btn-ghost px-6 py-2">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="btn-primary px-6 py-2 flex items-center gap-2">
                                {isSubmitting ? <Spinner size="sm" color="white" label="Creating…" /> : 'Create User'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Reset Password Modal */}
            {isResetOpen && resetTarget && (
                <Modal title="Reset Password" onClose={() => { setIsResetOpen(false); setResetPassword('') }}>
                    <form onSubmit={handleResetPassword} className="space-y-4">
                        <p className="text-sm text-slate-600">
                            Set a new temporary password for <span className="font-semibold text-slate-900">{resetTarget.name}</span>. Share it with them securely — they should change it after logging in.
                        </p>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">New Password</label>
                            <div className="relative">
                                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    required
                                    type="text"
                                    minLength={6}
                                    className="w-full p-2.5 pl-10 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-amber-400/20 text-sm"
                                    value={resetPassword}
                                    onChange={e => setResetPassword(e.target.value)}
                                    placeholder="Min. 6 characters"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                            <button type="button" onClick={() => { setIsResetOpen(false); setResetPassword('') }} className="btn-ghost px-6 py-2">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="px-6 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold flex items-center gap-2 transition-colors">
                                {isSubmitting ? <Spinner size="sm" color="white" label="Resetting…" /> : 'Reset Password'}
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
