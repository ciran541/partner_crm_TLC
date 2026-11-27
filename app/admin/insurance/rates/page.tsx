import RateDesk from '@/components/insurance/rates/RateDesk'

// Admin console: every rate change happens here (bank list → edit or paste a
// banker's message → review → publish, with history). Agents' page is read-only.
export default function AdminRatesPage() {
    return <RateDesk />
}
