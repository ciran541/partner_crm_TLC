import type { Case } from '@/lib/types'
import { formatCurrency } from '@/lib/utils/formatCurrency'

export default function CorrectionNotice({ data }: { data: Case }) {
    if (!data.corrections?.length) return null
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-bold">Submission corrections · {formatCurrency(data.correction_fee ?? 0)} deducted from payout</p>
        {data.corrections.map((c, i) => <p key={i} className="mt-2">{c.at.slice(0, 10)}: {c.reason} — {c.fee ? `${formatCurrency(c.fee)} fee` : 'Fee waived'}{c.mode === 'reopen' ? '. Returned for correction; review and submit again.' : ''}</p>)}
    </div>
}
