import { CheckCircle2 } from 'lucide-react'

/** "IPA done" chip — shown under the remark (Cases list) and on Track cards when cases.ipa_done is ticked. */
export default function IpaDoneBadge() {
    return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
            style={{ background: '#ccfbf1', color: '#0f766e' }}>
            <CheckCircle2 size={11} /> IPA done
        </span>
    )
}
