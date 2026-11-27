'use client'

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { SORT_COLUMNS, type ColumnSort, type SortColumn, type SortDir } from '@/lib/insurance/ownCases'

const LABELS: Record<SortColumn, Record<SortDir, string>> = {
    type: { asc: 'Type: A to Z', desc: 'Type: Z to A' },
    loan: { desc: 'Loan: largest first', asc: 'Loan: smallest first' },
    banker: { asc: 'Banker: A to Z', desc: 'Banker: Z to A' },
    input: { asc: 'Input date: earliest first', desc: 'Input date: latest first' },
    closed: { asc: 'Closed date: earliest first', desc: 'Closed date: latest first' },
    due: { asc: 'Follow-up: earliest first', desc: 'Follow-up: latest first' },
    remark: { asc: 'IPA done first', desc: 'IPA done last' },
}

/** A tappable column heading. The arrow shows the order in use. */
export function SortButton({ column, label, sort, onSort }: {
    column: SortColumn
    label: string
    sort: ColumnSort | null
    onSort: (column: SortColumn) => void
}) {
    const dir = sort?.column === column ? sort.dir : null
    const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ArrowUpDown
    return (
        <button
            type="button"
            onClick={() => onSort(column)}
            aria-label={dir ? `${label}, sorted. ${LABELS[column][dir]}` : `Sort by ${label}`}
            title={dir ? LABELS[column][dir] : `Sort by ${label}`}
            className="inline-flex items-center gap-1 -my-2.5 py-2.5 cursor-pointer hover:text-[#0369a1]"
            style={{ font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: dir ? '#0369a1' : undefined }}
        >
            {label}
            <Icon size={12} style={{ opacity: dir ? 1 : 0.45 }} />
        </button>
    )
}

/** The same orders as a dropdown, for phones. */
export function SortSelect({ dateColumn, sort, onChange, style }: {
    dateColumn: SortColumn
    sort: ColumnSort | null
    onChange: (sort: ColumnSort | null) => void
    style?: React.CSSProperties
}) {
    const columns = SORT_COLUMNS.filter(c => (c !== 'input' && c !== 'closed') || c === dateColumn)
    return (
        <select
            className="md:hidden"
            aria-label="Sort cases"
            value={sort ? `${sort.column}_${sort.dir}` : ''}
            onChange={e => {
                const [column, dir] = e.target.value.split('_') as [SortColumn, SortDir]
                onChange(e.target.value ? { column, dir } : null)
            }}
            style={style}
        >
            <option value="">Sort: recently updated</option>
            {columns.flatMap(c => (c === 'loan' ? ['desc', 'asc'] as const : ['asc', 'desc'] as const).map(d => (
                <option key={`${c}_${d}`} value={`${c}_${d}`}>{LABELS[c][d]}</option>
            )))}
        </select>
    )
}
