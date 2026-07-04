'use client'

function daysUntil(dateStr: string): number {
    const target = new Date(dateStr)
    const today = new Date()
    target.setHours(0, 0, 0, 0)
    today.setHours(0, 0, 0, 0)
    return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export default function CountdownBadge({ label, date }: { label: string; date: string | undefined }) {
    if (!date) {
        return (
            <div className="card !p-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
                <p className="text-sm text-slate-400">No upcoming date</p>
            </div>
        )
    }
    const days = daysUntil(date)
    return (
        <div className="card !p-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-2xl font-bold text-[#052d4a]">{days <= 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`}</p>
            <p className="text-xs text-slate-400 mt-0.5">
                {new Date(date).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
        </div>
    )
}
