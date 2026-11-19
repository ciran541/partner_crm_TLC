'use client'

import { useMemo, useState } from 'react'
import { Receipt, Search, Info } from 'lucide-react'
import { FieldInput } from '@/components/insurance/workflow/WorkflowStep'
import {
    VAL_FEE_PROPERTY_TYPES,
    VAL_FEE_TRANSACTIONS,
    lookupValuationFees,
    ValFeePropertyType,
} from '@/lib/insurance/valuationFees'

function FeeCell({ text, inherited }: { text: string | null; inherited: boolean }) {
    if (text === null) {
        return <span className="text-slate-300">—</span>
    }
    const norm = text.trim().toLowerCase()
    if (norm === 'not required') {
        return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700">Not Required</span>
    }
    if (norm === 'n/a') {
        return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500">N/A</span>
    }
    return (
        <div>
            <p className="whitespace-pre-line leading-snug text-slate-700">{text}</p>
            {inherited && (
                <p className="text-[11px] text-slate-400 mt-1">Same as tier above</p>
            )}
        </div>
    )
}

export default function ValuationFeesPage() {
    const [propertyType, setPropertyType] = useState<ValFeePropertyType>('HDB')
    const [transactionKey, setTransactionKey] = useState('resale')
    const [value, setValue] = useState('')

    const transactions = VAL_FEE_TRANSACTIONS[propertyType]

    function handlePropertyTypeChange(next: ValFeePropertyType) {
        setPropertyType(next)
        setTransactionKey(VAL_FEE_TRANSACTIONS[next][0].key)
    }

    const numericValue = value === '' ? 0 : Number(value)
    const result = useMemo(
        () => lookupValuationFees(propertyType, transactionKey, numericValue),
        [propertyType, transactionKey, numericValue],
    )
    const needsValue = (result?.bandCount ?? 1) > 1

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="ios-page-title flex items-center gap-2">
                    <Receipt size={22} className="text-[#03a9e7]" /> Valuation Fees
                </h1>
                <p className="page-subtitle">Look up bank valuation fees by property type, transaction type, and property value</p>
            </div>

            {/* Filter panel */}
            <div className="card !p-5">
                <div className={`grid grid-cols-1 sm:grid-cols-2 ${needsValue ? 'md:grid-cols-3' : ''} gap-x-6 gap-y-3`}>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Property Type</label>
                        <select
                            value={propertyType}
                            onChange={e => handlePropertyTypeChange(e.target.value as ValFeePropertyType)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-[#052d4a] focus:outline-none focus:ring-2 focus:ring-[#03a9e7]"
                        >
                            {VAL_FEE_PROPERTY_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs text-slate-500 mb-1 font-medium">Transaction Type</label>
                        <select
                            value={transactionKey}
                            onChange={e => setTransactionKey(e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-sm text-[#052d4a] focus:outline-none focus:ring-2 focus:ring-[#03a9e7]"
                        >
                            {transactions.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                        </select>
                    </div>
                    {needsValue && (
                        <div>
                            <label className="block text-xs text-slate-500 mb-1 font-medium">Property Value</label>
                            <FieldInput
                                value={value}
                                onChange={setValue}
                                placeholder="e.g. 1,800,000"
                                prefix="$"
                                commas
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Results */}
            {needsValue && !value && (
                <div className="card text-center py-16 text-slate-400">
                    <Search size={36} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">Enter a property value to see the applicable fees</p>
                </div>
            )}

            {result && (!needsValue || value) && (
                <div className="card !p-0 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                        <p className="text-sm font-semibold text-[#052d4a]">
                            {needsValue ? `Tier: ${result.band.label}` : 'All property values'}
                        </p>
                        <p className="text-xs text-slate-400">{result.entries.length} banks</p>
                    </div>
                    {result.note && (
                        <div className="flex items-start gap-2 px-5 py-3 bg-sky-50/70 border-b border-[#03a9e7]/15">
                            <Info size={13} className="text-[#03a9e7] shrink-0 mt-0.5" />
                            <p className="text-[12px] text-slate-600 leading-relaxed">{result.note}</p>
                        </div>
                    )}
                    <div className="table-scroll">
                    <table className="w-full text-sm">
                        <tbody>
                            {result.entries.map((entry, i) => (
                                <tr
                                    key={entry.bank}
                                    className={`border-b border-slate-50 last:border-0 ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}
                                >
                                    <td className="px-5 py-3 font-semibold text-[#052d4a] whitespace-nowrap w-32 align-top">
                                        {entry.bank}
                                    </td>
                                    <td className="px-5 py-3 align-top">
                                        <FeeCell text={entry.text} inherited={entry.inherited} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </div>
            )}

            <p className="text-xs text-slate-400 text-center">
                Fees shown are indicative reference figures collated from bank fee schedules and may change without notice — confirm with the banker before quoting a client.
            </p>
        </div>
    )
}
