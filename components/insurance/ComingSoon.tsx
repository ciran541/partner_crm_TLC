import type { LucideIcon } from 'lucide-react'

export default function ComingSoon({
    icon: Icon,
    title,
    description,
}: {
    icon: LucideIcon
    title: string
    description: string
}) {
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="ios-page-title flex items-center gap-2">
                    <Icon size={22} className="text-[#03a9e7]" /> {title}
                </h1>
                <p className="page-subtitle">{description}</p>
            </div>

            <div className="card p-12 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-sky-50 flex items-center justify-center mx-auto">
                    <Icon size={26} className="text-[#03a9e7]" />
                </div>
                <p className="font-semibold text-slate-700">{title} is coming soon</p>
                <p className="text-sm text-slate-500 max-w-md mx-auto">
                    We&apos;re building this out. Check back shortly.
                </p>
            </div>
        </div>
    )
}
