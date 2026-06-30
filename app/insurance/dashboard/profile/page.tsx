'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { User, Mail, Shield, Lock, Check, Eye, EyeOff, Users, TrendingUp, ChevronRight, CalendarCheck, CalendarX, X } from 'lucide-react'
import Spinner from '@/components/shared/Spinner'
import InlineAlert from '@/components/shared/InlineAlert'
import Skeleton from '@/components/shared/Skeleton'

export default function InsuranceProfilePage() {
    const [loading, setLoading] = useState(true)
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [role, setRole] = useState('')
    const [nameAlert, setNameAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [pwAlert, setPwAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [savingName, setSavingName] = useState(false)
    const [savingPw, setSavingPw] = useState(false)
    const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
    const [showCurrent, setShowCurrent] = useState(false)
    const [showNew, setShowNew] = useState(false)
    const [showConfirm, setShowConfirm] = useState(false)

    // Google Calendar integration
    const searchParams = useSearchParams()
    const [calendarConnected, setCalendarConnected] = useState(false)
    const [calendarLoading, setCalendarLoading] = useState(false)
    const [calendarAlert, setCalendarAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    useEffect(() => {
        fetch('/api/insurance/google/status')
            .then(r => r.ok ? r.json() : { connected: false })
            .then(j => setCalendarConnected(!!j.connected))
            .catch(() => {})

        const cal = searchParams.get('calendar')
        const calErr = searchParams.get('calendar_error')
        if (cal === 'connected') {
            setCalendarConnected(true)
            setCalendarAlert({ type: 'success', message: 'Google Calendar connected — follow-up dates will sync automatically.' })
        } else if (calErr) {
            setCalendarAlert({ type: 'error', message: 'Google Calendar connection failed. Please try again.' })
        }
    }, [searchParams])

    const handleDisconnectCalendar = async () => {
        setCalendarLoading(true)
        try {
            const res = await fetch('/api/insurance/google/disconnect', { method: 'POST' })
            if (!res.ok) throw new Error('Disconnect failed')
            setCalendarConnected(false)
            setCalendarAlert({ type: 'success', message: 'Google Calendar disconnected.' })
        } catch {
            setCalendarAlert({ type: 'error', message: 'Failed to disconnect. Please try again.' })
        } finally {
            setCalendarLoading(false)
        }
    }

    useEffect(() => {
        const load = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return
            setEmail(user.email ?? '')

            const { data: profile } = await supabase
                .from('profiles')
                .select('name, role')
                .eq('id', user.id)
                .single()

            if (profile) {
                setName(profile.name ?? '')
                setRole(profile.role ?? 'agent')
            }
            setLoading(false)
        }
        load()
    }, [])

    const handleSaveName = async (e: React.FormEvent) => {
        e.preventDefault()
        setSavingName(true)
        setNameAlert(null)
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setSavingName(false); return }

        const { error } = await supabase
            .from('profiles')
            .update({ name: name.trim() })
            .eq('id', user.id)

        setSavingName(false)
        if (error) {
            setNameAlert({ type: 'error', message: error.message })
        } else {
            setNameAlert({ type: 'success', message: 'Name updated successfully.' })
        }
    }

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault()
        setPwAlert(null)

        if (pwForm.next.length < 6) {
            setPwAlert({ type: 'error', message: 'New password must be at least 6 characters.' })
            return
        }
        if (pwForm.next !== pwForm.confirm) {
            setPwAlert({ type: 'error', message: 'New passwords do not match.' })
            return
        }

        setSavingPw(true)

        // Verify current password by re-authenticating
        const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password: pwForm.current,
        })
        if (signInError) {
            setPwAlert({ type: 'error', message: 'Current password is incorrect.' })
            setSavingPw(false)
            return
        }

        const { error: updateError } = await supabase.auth.updateUser({ password: pwForm.next })
        setSavingPw(false)

        if (updateError) {
            setPwAlert({ type: 'error', message: updateError.message })
        } else {
            setPwAlert({ type: 'success', message: 'Password changed successfully.' })
            setPwForm({ current: '', next: '', confirm: '' })
        }
    }

    if (loading) return (
        <div className="space-y-6 max-w-2xl">
            <Skeleton height={36} width={200} radius={8} />
            <Skeleton height={140} radius={14} />
            <Skeleton height={120} radius={14} />
            <Skeleton height={260} radius={14} />
        </div>
    )

    const roleLabel = role === 'admin' || role === 'super_admin' ? 'Administrator' : 'Partner Agent'
    const roleBadgeClass = role === 'admin' || role === 'super_admin'
        ? 'bg-purple-50 text-purple-700 border border-purple-100'
        : 'bg-sky-50 text-sky-700 border border-sky-100'

    return (
        <div className="space-y-6 max-w-2xl">
            <div>
                <h1 className="ios-page-title flex items-center gap-2">
                    <User size={26} className="text-[#03a9e7]" />
                    My Profile
                </h1>
                <p className="page-subtitle">Manage your account details and password.</p>
            </div>

            {/* Account Info */}
            <div className="card p-6 space-y-5">
                <h2 className="text-base font-semibold text-slate-800">Account Information</h2>

                <div className="flex items-center gap-3">
                    <Mail size={16} className="text-slate-400 shrink-0" />
                    <div>
                        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Email</p>
                        <p className="text-sm text-slate-700 font-medium">{email}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Shield size={16} className="text-slate-400 shrink-0" />
                    <div>
                        <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Role</p>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold mt-0.5 ${roleBadgeClass}`}>
                            {roleLabel}
                        </span>
                    </div>
                </div>
            </div>

            {/* Integrations — Google Calendar */}
            <div className="card p-6 space-y-4">
                <h2 className="text-base font-semibold text-slate-800">Integrations</h2>
                {calendarAlert && (
                    <InlineAlert type={calendarAlert.type} message={calendarAlert.message} onDismiss={() => setCalendarAlert(null)} />
                )}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#f0fdf4' }}>
                            {calendarConnected ? <CalendarCheck size={15} color="#059669" /> : <CalendarX size={15} color="#94a3b8" />}
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-800">Google Calendar</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                                {calendarConnected
                                    ? 'Connected — follow-up dates sync to your calendar automatically.'
                                    : 'Connect to auto-add follow-up dates to your Google Calendar.'}
                            </p>
                        </div>
                    </div>
                    {calendarConnected ? (
                        <button
                            onClick={handleDisconnectCalendar}
                            disabled={calendarLoading}
                            className="shrink-0 flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 transition-colors border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 disabled:opacity-60"
                        >
                            {calendarLoading ? <Spinner size="sm" color="#dc2626" label="" /> : <X size={13} />}
                            Disconnect
                        </button>
                    ) : (
                        <a
                            href="/api/insurance/google/auth"
                            className="shrink-0 flex items-center gap-1.5 text-sm font-semibold text-white rounded-lg px-4 py-2 transition-colors"
                            style={{ background: '#059669' }}
                        >
                            <CalendarCheck size={14} /> Connect
                        </a>
                    )}
                </div>
            </div>

            {/* Admin tools — surfaced here so mobile admins can reach them (not in the bottom tab bar) */}
            {(role === 'admin' || role === 'super_admin') && (
                <div className="card p-6">
                    <h2 className="text-base font-semibold text-slate-800 mb-4">Admin Tools</h2>
                    <div className="space-y-2">
                        <Link href="/insurance/dashboard/users" className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-[#03a9e7] hover:bg-sky-50/50 transition-colors">
                            <div className="w-9 h-9 rounded-lg bg-sky-50 text-[#03a9e7] flex items-center justify-center shrink-0"><Users size={18} /></div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800">User Management</p>
                                <p className="text-xs text-slate-400">Manage agents and admins</p>
                            </div>
                            <ChevronRight size={16} className="text-slate-300" />
                        </Link>
                        <Link href="/insurance/dashboard/analytics" className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-[#03a9e7] hover:bg-sky-50/50 transition-colors">
                            <div className="w-9 h-9 rounded-lg bg-sky-50 text-[#03a9e7] flex items-center justify-center shrink-0"><TrendingUp size={18} /></div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-slate-800">Analytics</p>
                                <p className="text-xs text-slate-400">View performance metrics</p>
                            </div>
                            <ChevronRight size={16} className="text-slate-300" />
                        </Link>
                    </div>
                </div>
            )}

            {/* Edit Name */}
            <div className="card p-6">
                <h2 className="text-base font-semibold text-slate-800 mb-4">Display Name</h2>

                {nameAlert && (
                    <div className="mb-4">
                        <InlineAlert
                            type={nameAlert.type}
                            message={nameAlert.message}
                            onDismiss={() => setNameAlert(null)}
                        />
                    </div>
                )}

                <form onSubmit={handleSaveName} className="flex gap-3 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Enter your full name"
                            className="w-full p-2.5 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#03a9e7]/20 focus:border-[#03a9e7] transition-all"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={savingName || !name.trim()}
                        className="btn-primary px-5 py-2.5 flex items-center gap-2 shrink-0"
                    >
                        {savingName
                            ? <Spinner size="sm" color="white" label="Saving…" />
                            : <><Check size={16} /><span>Save</span></>
                        }
                    </button>
                </form>
            </div>

            {/* Change Password */}
            <div className="card p-6">
                <h2 className="text-base font-semibold text-slate-800 mb-1">Change Password</h2>
                <p className="text-sm text-slate-500 mb-4">
                    After an admin resets your password, use this to set a new one.
                </p>

                {pwAlert && (
                    <div className="mb-4">
                        <InlineAlert
                            type={pwAlert.type}
                            message={pwAlert.message}
                            onDismiss={() => setPwAlert(null)}
                        />
                    </div>
                )}

                <form onSubmit={handleChangePassword} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Current Password</label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type={showCurrent ? 'text' : 'password'}
                                required
                                value={pwForm.current}
                                onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                                placeholder="Enter your current password"
                                className="w-full p-2.5 pl-10 pr-10 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#03a9e7]/20 focus:border-[#03a9e7] transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowCurrent(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                {showCurrent ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">New Password</label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type={showNew ? 'text' : 'password'}
                                required
                                value={pwForm.next}
                                onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                                placeholder="Min. 6 characters"
                                className="w-full p-2.5 pl-10 pr-10 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#03a9e7]/20 focus:border-[#03a9e7] transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm New Password</label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type={showConfirm ? 'text' : 'password'}
                                required
                                value={pwForm.confirm}
                                onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                                placeholder="Repeat new password"
                                className="w-full p-2.5 pl-10 pr-10 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#03a9e7]/20 focus:border-[#03a9e7] transition-all"
                            />
                            <button
                                type="button"
                                onClick={() => setShowConfirm(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            >
                                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                        </div>
                    </div>

                    <div className="pt-1">
                        <button
                            type="submit"
                            disabled={savingPw || !pwForm.current || !pwForm.next || !pwForm.confirm}
                            className="btn-primary px-6 py-2.5 flex items-center gap-2"
                        >
                            {savingPw
                                ? <Spinner size="sm" color="white" label="Updating…" />
                                : <><Lock size={16} /><span>Update Password</span></>
                            }
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
