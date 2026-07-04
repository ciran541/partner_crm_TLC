'use client'

import { Star } from 'lucide-react'

export default function ImpactStars({ count }: { count: number }) {
    return (
        <span className="inline-flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map(i => (
                <Star key={i} size={13} className={i <= count ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />
            ))}
        </span>
    )
}
