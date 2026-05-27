'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { User, Shield, Phone, Building2, BadgeCheck, Mail, Calendar, Edit2, X, Check, AlertCircle, LogOut, Lock, ChevronDown, CalendarCheck, CalendarX } from 'lucide-react'
import { formatDate } from '@/lib/utils/formatDate'
import { supabase } from '@/lib/supabaseClient'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'

interface ProfileData {
    id: string
    name: string
    full_name: string | null
    mobile: string | null
    cea_registration_no: string | null
    agency_name: string | null
    joined_at: string | null
    email: string | null
    role: string
    status: string
    app_type: string
}

interface FormState {
    full_name: string
    mobile: string
    cea_registration_no: string
    agency_name: string
}

interface FieldErrors {
    full_name?: string
    mobile?: string
    cea_registration_no?: string
}

export default function PropertyProfilePage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [profile, setProfile] = useState<ProfileData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [editing, setEditing] = useState(false)
    const [saving, setSaving] = useState(false)
    const [saveSuccess, setSaveSuccess] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

    const [form, setForm] = useState<FormState>({
        full_name: '',
        mobile: '',
        cea_registration_no: '',
        agency_name: '',
    })

    const [changingPassword, setChangingPassword] = useState(false)
    const [pwSaving, setPwSaving] = useState(false)
    const [pwError, setPwError] = useState<string | null>(null)
    const [pwSuccess, setPwSuccess] = useState(false)
    const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })

    // Google Calendar integration state
    const [calendarConnected, setCalendarConnected] = useState(false)
    const [calendarLoading, setCalendarLoading] = useState(false)
    const [calendarSuccess, setCalendarSuccess] = useState<string | null>(null)
    const [calendarError, setCalendarError] = useState<string | null>(null)

    useEffect(() => {
        fetchProfile()
        fetchCalendarStatus()

        // Handle redirect back from Google OAuth
        const cal = searchParams.get('calendar')
        const calErr = searchParams.get('calendar_error')
        if (cal === 'connected') {
            setCalendarSuccess('Google Calendar connected successfully! Follow-up dates will now appear in your calendar.')
            // Clean up URL params
            router.replace('/property/profile')
        } else if (calErr) {
            const msgs: Record<string, string> = {
                access_denied: 'You denied calendar access. Connect again to enable sync.',
                token_exchange: 'Failed to complete Google authorisation. Please try again.',
                no_code: 'Google did not return an authorisation code. Please try again.',
            }
            setCalendarError(msgs[calErr] ?? 'Google Calendar connection failed. Please try again.')
            router.replace('/property/profile')
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function handleSignOut() {
        await supabase.auth.signOut()
        router.push('/property/login')
    }

    async function fetchCalendarStatus() {
        try {
            const res = await fetch('/api/property/google/status')
            if (res.ok) {
                const json = await res.json()
                setCalendarConnected(json.connected ?? false)
            }
        } catch {
            // non-critical — silently ignore
        }
    }

    async function handleDisconnectCalendar() {
        setCalendarLoading(true)
        setCalendarError(null)
        try {
            const res = await fetch('/api/property/google/disconnect', { method: 'POST' })
            if (!res.ok) throw new Error('Disconnect failed')
            setCalendarConnected(false)
            setCalendarSuccess('Google Calendar disconnected.')
            setTimeout(() => setCalendarSuccess(null), 4000)
        } catch {
            setCalendarError('Failed to disconnect. Please try again.')
        } finally {
            setCalendarLoading(false)
        }
    }

    async function fetchProfile() {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch('/api/property/profile')
            if (!res.ok) throw new Error('Failed to load profile')
            const json = await res.json()
            setProfile(json.data)
            setForm({
                full_name: json.data.full_name ?? '',
                mobile: json.data.mobile ?? '',
                cea_registration_no: json.data.cea_registration_no ?? '',
                agency_name: json.data.agency_name ?? '',
            })
        } catch {
            setError('Unable to load your profile. Please refresh the page.')
        } finally {
            setLoading(false)
        }
    }

    function openEdit() {
        setSaveSuccess(false)
        setSaveError(null)
        setFieldErrors({})
        setEditing(true)
    }

    function cancelEdit() {
        // Reset form to current profile values
        if (profile) {
            setForm({
                full_name: profile.full_name ?? '',
                mobile: profile.mobile ?? '',
                cea_registration_no: profile.cea_registration_no ?? '',
                agency_name: profile.agency_name ?? '',
            })
        }
        setFieldErrors({})
        setSaveError(null)
        setEditing(false)
    }

    async function handleSave() {
        setSaving(true)
        setSaveError(null)
        setFieldErrors({})

        try {
            const res = await fetch('/api/property/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            })

            const json = await res.json()

            if (!res.ok) {
                if (json.fields) {
                    setFieldErrors(json.fields)
                } else {
                    setSaveError(json.error ?? 'Failed to save profile')
                }
                return
            }

            setProfile(json.data)
            setEditing(false)
            setSaveSuccess(true)
            setTimeout(() => setSaveSuccess(false), 4000)
        } catch {
            setSaveError('An unexpected error occurred. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault()
        setPwError(null)
        if (pwForm.next.length < 6) { setPwError('New password must be at least 6 characters.'); return }
        if (pwForm.next !== pwForm.confirm) { setPwError('New passwords do not match.'); return }

        setPwSaving(true)
        // Verify current password by re-authenticating
        const { error: signInError } = await supabase.auth.signInWithPassword({
            email: profile?.email ?? '',
            password: pwForm.current,
        })
        if (signInError) { setPwError('Current password is incorrect.'); setPwSaving(false); return }

        const { error: updateError } = await supabase.auth.updateUser({ password: pwForm.next })
        setPwSaving(false)
        if (updateError) { setPwError(updateError.message); return }

        setPwForm({ current: '', next: '', confirm: '' })
        setChangingPassword(false)
        setPwSuccess(true)
        setTimeout(() => setPwSuccess(false), 4000)
    }

    const displayName = profile?.full_name || profile?.name || profile?.email?.split('@')[0] || 'Agent'
    const initials = displayName.charAt(0).toUpperCase()

    if (loading) {
        return (
            <div className="space-y-6">
                <PageHeader />
                <div className="card p-8 flex items-center justify-center">
                    <Spinner size="md" color="#059669" label="Loading profile…" />
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="space-y-6">
                <PageHeader />
                <div className="card p-8 text-center">
                    <AlertCircle size={32} className="mx-auto mb-3 text-red-400" />
                    <p className="text-slate-600 text-sm">{error}</p>
                    <button onClick={fetchProfile} className="mt-4 btn-primary text-sm px-4 py-2">Retry</button>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 max-w-2xl">
            <PageHeader />

            {saveSuccess && (
                <InlineAlert type="success" message="Profile updated successfully." onDismiss={() => setSaveSuccess(false)} />
            )}
            {pwSuccess && (
                <InlineAlert type="success" message="Password changed successfully." onDismiss={() => setPwSuccess(false)} />
            )}
            {calendarSuccess && (
                <InlineAlert type="success" message={calendarSuccess} onDismiss={() => setCalendarSuccess(null)} />
            )}
            {calendarError && (
                <InlineAlert type="error" message={calendarError} onDismiss={() => setCalendarError(null)} />
            )}

            {/* Profile Header Card */}
            <div className="card p-6">
                <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold shrink-0" style={{ background: '#052d4a' }}>
                        {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-bold text-slate-800 truncate">{displayName}</h2>
                        <p className="text-sm text-slate-500 truncate">{profile?.email}</p>
                        <div className="flex flex-wrap gap-2 mt-2">
                            {profile?.cea_registration_no && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">
                                    <BadgeCheck size={11} />
                                    CEA {profile.cea_registration_no}
                                </span>
                            )}
                            {profile?.agency_name && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                                    <Building2 size={11} />
                                    {profile.agency_name}
                                </span>
                            )}
                        </div>
                    </div>
                    {!editing && (
                        <button onClick={openEdit} className="flex items-center gap-1.5 text-sm text-emerald-700 font-medium hover:text-emerald-800 transition-colors shrink-0">
                            <Edit2 size={14} />
                            Edit
                        </button>
                    )}
                </div>
            </div>

            {/* Edit Form */}
            {editing && (
                <div className="card p-6 space-y-5">
                    <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-slate-800">Edit Profile</h3>
                        <button onClick={cancelEdit} className="text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={18} />
                        </button>
                    </div>

                    {saveError && (
                        <InlineAlert type="error" message={saveError} onDismiss={() => setSaveError(null)} />
                    )}

                    <div className="grid gap-4">
                        <FormField
                            label="Full Name"
                            required
                            value={form.full_name}
                            onChange={v => setForm(f => ({ ...f, full_name: v }))}
                            error={fieldErrors.full_name}
                            placeholder="e.g. Jane Tan"
                        />
                        <FormField
                            label="Mobile Number"
                            required
                            value={form.mobile}
                            onChange={v => setForm(f => ({ ...f, mobile: v }))}
                            error={fieldErrors.mobile}
                            placeholder="+65 9123 4567"
                        />
                        <FormField
                            label="CEA Registration No."
                            required
                            value={form.cea_registration_no}
                            onChange={v => setForm(f => ({ ...f, cea_registration_no: v }))}
                            error={fieldErrors.cea_registration_no}
                            placeholder="e.g. R012345A"
                        />
                        <FormField
                            label="Agency Name"
                            value={form.agency_name}
                            onChange={v => setForm(f => ({ ...f, agency_name: v }))}
                            placeholder="e.g. PropNex Realty"
                        />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="btn-emerald flex items-center gap-2 text-sm px-5 py-2.5"
                            style={{ opacity: saving ? 0.7 : 1 }}
                        >
                            {saving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Check size={14} /> Save Changes</>}
                        </button>
                        <button onClick={cancelEdit} disabled={saving} className="btn-ghost text-sm px-4 py-2.5">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Profile Details */}
            {!editing && (
                <div className="card p-6 space-y-4">
                    <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Agent Details</h3>
                    <div className="grid gap-4">
                        <InfoRow icon={User} label="Full Name" value={profile?.full_name} placeholder="Not set" />
                        <InfoRow icon={Phone} label="Mobile" value={profile?.mobile} placeholder="Not set" />
                        <InfoRow icon={BadgeCheck} label="CEA Registration" value={profile?.cea_registration_no} placeholder="Not set — required" highlight={!profile?.cea_registration_no} />
                        <InfoRow icon={Building2} label="Agency" value={profile?.agency_name} placeholder="Not set" />
                    </div>
                </div>
            )}

            {/* Account Info */}
            <div className="card p-6 space-y-4" style={{ marginTop: 4 }}>
                <h3 className="section-label">Account</h3>
                <div className="grid gap-4">
                    <InfoRow icon={Mail} label="Email" value={profile?.email} />
                    <InfoRow icon={Shield} label="Role" value={profile?.role === 'super_admin' ? 'Super Admin' : profile?.role === 'admin' ? 'Admin' : 'Property Agent'} />
                    <InfoRow icon={Calendar} label="Joined" value={profile?.joined_at ? formatDate(profile.joined_at) : null} placeholder="—" />
                </div>
            </div>

            {/* Integrations */}
            <div className="card p-6 space-y-4">
                <h3 className="section-label">Integrations</h3>

                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#f0fdf4' }}>
                            {calendarConnected
                                ? <CalendarCheck size={15} color="#059669" />
                                : <CalendarX size={15} color="#94a3b8" />
                            }
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800">Google Calendar</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                                {calendarConnected
                                    ? 'Connected — follow-up dates sync to your calendar automatically.'
                                    : 'Connect to auto-add follow-up dates to your Google Calendar.'
                                }
                            </p>
                        </div>
                    </div>

                    {calendarConnected ? (
                        <button
                            onClick={handleDisconnectCalendar}
                            disabled={calendarLoading}
                            className="shrink-0 flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 transition-colors border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50"
                            style={{ opacity: calendarLoading ? 0.6 : 1 }}
                        >
                            {calendarLoading ? <Spinner size="sm" color="#dc2626" label="" /> : <X size={13} />}
                            Disconnect
                        </button>
                    ) : (
                        <a
                            href="/api/property/google/auth"
                            className="shrink-0 flex items-center gap-1.5 text-sm font-semibold text-white rounded-lg px-4 py-2 transition-colors"
                            style={{ background: '#059669' }}
                        >
                            <CalendarCheck size={14} />
                            Connect
                        </a>
                    )}
                </div>
            </div>

            {/* Change Password */}
            <div className="card overflow-hidden">
                <button
                    onClick={() => { setChangingPassword(v => !v); setPwError(null); setPwForm({ current: '', next: '', confirm: '' }) }}
                    className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                            <Lock size={15} color="#64748b" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800">Change Password</p>
                            <p className="text-xs text-slate-400 mt-0.5">Update your login password</p>
                        </div>
                    </div>
                    <ChevronDown
                        size={18}
                        color="#94a3b8"
                        style={{ transform: changingPassword ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                    />
                </button>

                {changingPassword && (
                    <form onSubmit={handleChangePassword} className="px-6 pb-6 space-y-4 border-t border-slate-100 pt-5">
                        {pwError && (
                            <InlineAlert type="error" message={pwError} onDismiss={() => setPwError(null)} />
                        )}
                        <PasswordField
                            label="Current Password"
                            value={pwForm.current}
                            onChange={v => setPwForm(f => ({ ...f, current: v }))}
                            placeholder="Enter your current password"
                        />
                        <PasswordField
                            label="New Password"
                            value={pwForm.next}
                            onChange={v => setPwForm(f => ({ ...f, next: v }))}
                            placeholder="At least 6 characters"
                        />
                        <PasswordField
                            label="Confirm New Password"
                            value={pwForm.confirm}
                            onChange={v => setPwForm(f => ({ ...f, confirm: v }))}
                            placeholder="Re-enter new password"
                        />
                        <div className="flex gap-3 pt-1">
                            <button
                                type="submit"
                                disabled={pwSaving}
                                className="btn-emerald flex items-center gap-2 text-sm px-5 py-2.5"
                                style={{ opacity: pwSaving ? 0.7 : 1 }}
                            >
                                {pwSaving ? <Spinner size="sm" color="white" label="Saving…" /> : <><Check size={14} /> Update Password</>}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setChangingPassword(false); setPwError(null) }}
                                disabled={pwSaving}
                                className="btn-ghost text-sm px-4 py-2.5"
                            >
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {/* Sign Out */}
            <button
                onClick={handleSignOut}
                className="card pressable w-full flex items-center justify-center gap-2 font-semibold"
                style={{ padding: '14px', color: '#dc2626', cursor: 'pointer' }}
            >
                <LogOut size={16} />
                Sign Out
            </button>
        </div>
    )
}

function PageHeader() {
    return (
        <div>
            <h1 className="text-[28px] md:text-2xl font-extrabold tracking-tight text-[#052d4a] flex items-center gap-2">
                <User size={26} color="#059669" />
                Profile
            </h1>
            <p className="text-sm text-slate-500 mt-1">Manage your agent profile and account details.</p>
        </div>
    )
}

function InfoRow({
    icon: Icon,
    label,
    value,
    placeholder = '—',
    highlight = false,
}: {
    icon: React.ElementType
    label: string
    value?: string | null
    placeholder?: string
    highlight?: boolean
}) {
    return (
        <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0 mt-0.5">
                <Icon size={15} color="#64748b" />
            </div>
            <div className="min-w-0">
                <p className="text-xs text-slate-400 font-medium">{label}</p>
                {value ? (
                    <p className="text-sm text-slate-800 font-medium truncate">{value}</p>
                ) : (
                    <p className={`text-sm ${highlight ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>{placeholder}</p>
                )}
            </div>
        </div>
    )
}

function PasswordField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    placeholder?: string
}) {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
            <input
                type="password"
                required
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 transition-colors"
            />
        </div>
    )
}

function FormField({
    label,
    value,
    onChange,
    error,
    placeholder,
    required = false,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    error?: string
    placeholder?: string
    required?: boolean
}) {
    return (
        <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {label}
                {required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <input
                type="text"
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={`w-full px-3 py-2.5 text-sm rounded-lg border transition-colors outline-none
                    ${error
                        ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                        : 'border-slate-200 bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
                    }`}
            />
            {error && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle size={11} />
                    {error}
                </p>
            )}
        </div>
    )
}
