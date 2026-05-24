import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePropertyUser } from '@/lib/auth/requirePropertyUser'

export type NotificationType =
    | 'reminder'
    | 'status_changed'
    | 'commission_updated'
    | 'lockin_confirmed'
    | 'admin_update'

export interface NotificationItem {
    id: string
    type: NotificationType
    title: string
    body: string
    case_id: string
    client_name: string
    date: string
}

function statusLabel(raw: unknown): string {
    if (typeof raw !== 'string') return 'unknown'
    return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export async function GET() {
    const auth = await requirePropertyUser()
    if (!auth.authorized) return auth.response

    const admin = createAdminClient()

    // Fetch all agent's cases for ID + client_name lookup
    const { data: cases } = await admin
        .from('property_cases')
        .select('id, client_name')
        .eq('agent_id', auth.userId)

    if (!cases || cases.length === 0) {
        return NextResponse.json({ notifications: [] })
    }

    const caseIds = cases.map(c => c.id)
    const caseMap = Object.fromEntries(cases.map(c => [c.id, c.client_name as string]))

    // Activity logs from the last 60 days, excluding self-submitted actions
    const since = new Date()
    since.setDate(since.getDate() - 60)

    const { data: logs } = await admin
        .from('property_case_activity_logs')
        .select('id, case_id, action, new_value, created_at')
        .in('case_id', caseIds)
        .neq('actor_id', auth.userId)          // only actions by TLC / admin, not the agent
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(50)

    // Reminders: trigger_date within last 7 days or any future date
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: reminders } = await admin
        .from('property_reminders')
        .select('id, case_id, trigger_date, is_sent')
        .in('case_id', caseIds)
        .gte('trigger_date', sevenDaysAgo.toISOString().split('T')[0])
        .order('trigger_date', { ascending: true })

    const notifications: NotificationItem[] = []

    // Build notification items from activity logs
    for (const log of logs ?? []) {
        const clientName = caseMap[log.case_id] ?? 'Client'
        let type: NotificationType = 'admin_update'
        let title = 'Case updated by TLC team'

        const newVal = log.new_value as Record<string, unknown> | null

        switch (log.action) {
            case 'status_changed': {
                const s = newVal?.status
                type = 'status_changed'
                title = `Status changed to ${statusLabel(s)}`
                break
            }
            case 'commission_updated': {
                const cs = newVal?.commission_status
                type = 'commission_updated'
                title = `Commission marked as ${statusLabel(cs)}`
                break
            }
            case 'lockin_confirmed':
                type = 'lockin_confirmed'
                title = 'Lock-in date confirmed by TLC'
                break
            default:
                type = 'admin_update'
                title = 'Case updated by TLC team'
        }

        notifications.push({
            id: log.id,
            type,
            title,
            body: clientName,
            case_id: log.case_id,
            client_name: clientName,
            date: log.created_at,
        })
    }

    // Build reminder notifications
    const today = new Date()
    for (const reminder of reminders ?? []) {
        const clientName = caseMap[reminder.case_id] ?? 'Client'
        const triggerDate = new Date(reminder.trigger_date)
        const daysUntil = Math.ceil((triggerDate.getTime() - today.getTime()) / 86400000)

        let body: string
        if (daysUntil < 0) {
            body = `Lock-in maturity was ${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} ago`
        } else if (daysUntil === 0) {
            body = 'Lock-in maturity is today'
        } else {
            body = `Lock-in maturity in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`
        }

        notifications.push({
            id: reminder.id,
            type: 'reminder',
            title: '90-Day Lock-in Reminder',
            body: `${clientName} — ${body}`,
            case_id: reminder.case_id,
            client_name: clientName,
            date: reminder.trigger_date + 'T00:00:00.000Z',
        })
    }

    // Sort all notifications newest first
    notifications.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return NextResponse.json({ notifications: notifications.slice(0, 50) })
}
