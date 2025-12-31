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
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.email && p.email.toLowerCase().includes(searchQuery.toLowerCase()))
    )

    if (loading) return <div style={{ padding: 40, color: '#052d4a' }}>Loading users...</div>

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#052d4a', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <User size={28} color="#03a9e7" />
                        User Management
                    </h1>
                    <p style={{ color: '#64748b', marginTop: 4 }}>Manage partner agents and administrators.</p>
                </div>
                <button
                    onClick={() => setIsCreateOpen(true)}
                    className="btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                    <Plus size={18} />
                    Add User
                </button>
            </div>

            {/* Toolbar */}
            <div className="card" style={{ padding: '16px', marginBottom: '24px', display: 'flex', alignItems: 'center' }}>
                <div style={{ position: 'relative', width: '300px' }}>
                    <Search size={16} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                        type="text"
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '10px 12px 10px 36px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            fontSize: '14px',
                            outline: 'none'
                        }}
                    />
                </div>
                <div style={{ marginLeft: 'auto', fontSize: '14px', color: '#64748b' }}>
                    Total Users: <strong>{profiles.length}</strong>
                </div>
            </div>

            {/* Users Table */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <tr>
                            <th style={thStyle}>Name</th>
                            <th style={thStyle}>Email</th>
                            <th style={thStyle}>Role</th>
                            <th style={thStyle}>Created At</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredProfiles.map((p) => (
                            <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={tdStyle}>
                                    <div style={{ fontWeight: '500', color: '#0f172a' }}>{p.name}</div>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569' }}>
                                        <Mail size={14} /> {p.email}
                                    </div>
                                </td>
                                <td style={tdStyle}>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 4,
                                        padding: '4px 10px', borderRadius: '12px',
                                        fontSize: '12px', fontWeight: '600',
                                        background: p.role === 'admin' ? '#f0fdf4' : '#e0f2fe',
                                        color: p.role === 'admin' ? '#15803d' : '#0369a1'
                                    }}>
                                        {p.role === 'admin' && <Shield size={12} />}
                                        {p.role.toUpperCase()}
                                    </span>
                                </td>
                                <td style={tdStyle}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b' }}>
                                        <Calendar size={14} />
                                        {new Date(p.created_at).toLocaleDateString()}
                                    </div>
                                </td>
                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                    <button
                                        onClick={() => {
                                            setEditForm({ id: p.id, name: p.name, role: p.role })
                                            setIsEditOpen(true)
                                        }}
                                        style={{
                                            padding: '6px',
                                            borderRadius: '4px',
                                            border: '1px solid #cbd5e1',
                                            background: 'white',
                                            color: '#475569',
                                            cursor: 'pointer'
                                        }}
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

            {/* Create Modal */}
            {isCreateOpen && (
                <Modal title="Add New User" onClose={() => setIsCreateOpen(false)}>
                    <form onSubmit={handleCreateUser}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={labelStyle}>Full Name</label>
                            <input
                                required
                                type="text"
                                className="input-field-std"
                                value={createForm.name}
                                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                            />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <label style={labelStyle}>Email Address</label>
                            <input
                                required
                                type="email"
                                className="input-field-std"
                                value={createForm.email}
                                onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                            />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <label style={labelStyle}>System Role</label>
                            <select
                                className="input-field-std"
                                value={createForm.role}
                                onChange={e => setCreateForm({ ...createForm, role: e.target.value as any })}
                            >
                                <option value="agent">Agent</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div style={{ marginBottom: 24 }}>
                            <label style={labelStyle}>Temporary Password</label>
                            <div style={{ position: 'relative' }}>
                                <Lock size={16} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
                                <input
                                    required
                                    type="text"
                                    className="input-field-std"
                                    style={{ paddingLeft: 32 }}
                                    value={createForm.password}
                                    onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                                    placeholder="Set a dedicated password"
                                />
                            </div>
                            <p style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>User can change this later (if feature built) or Admin can reset.</p>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button type="button" onClick={() => setIsCreateOpen(false)} className="btn-outline">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="btn-primary">
                                {isSubmitting ? 'Creating...' : 'Create User'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            {/* Edit Modal */}
            {isEditOpen && (
                <Modal title="Edit User" onClose={() => setIsEditOpen(false)}>
                    <form onSubmit={handleEditUser}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={labelStyle}>Full Name</label>
                            <input
                                required
                                type="text"
                                className="input-field-std"
                                value={editForm.name}
                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            />
                        </div>
                        <div style={{ marginBottom: 24 }}>
                            <label style={labelStyle}>System Role</label>
                            <select
                                className="input-field-std"
                                value={editForm.role}
                                onChange={e => setEditForm({ ...editForm, role: e.target.value as any })}
                            >
                                <option value="agent">Agent</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button type="button" onClick={() => setIsEditOpen(false)} className="btn-outline">Cancel</button>
                            <button type="submit" disabled={isSubmitting} className="btn-primary">
                                {isSubmitting ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                </Modal>
            )}

            <style jsx global>{`
                .input-field-std {
                    width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; fontSize: 14px; outline: none;
                }
                .input-field-std:focus { border-color: #03a9e7; }
            `}</style>
        </div>
    )
}

// Helpers & Components

const thStyle: React.CSSProperties = {
    padding: '16px', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em'
}

const tdStyle: React.CSSProperties = {
    padding: '16px', fontSize: '14px'
}

const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#475569'
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(5, 45, 74, 0.5)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div className="card" style={{ width: '400px', padding: 0, overflow: 'hidden', animation: 'fadeIn 0.2s' }}>
                <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#0f172a' }}>{title}</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                        <X size={20} />
                    </button>
                </div>
                <div style={{ padding: '24px' }}>
                    {children}
                </div>
            </div>
        </div>
    )
}
