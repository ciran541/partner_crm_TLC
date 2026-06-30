/**
 * Formats a numeric amount as currency for display.
 * Keeps existing en-US / USD behavior from the original codebase.
 */
export function formatCurrency(amount?: number): string {
    if (!amount) return '-'
    return new Intl.NumberFormat('en-SG', {
        style: 'currency',
        currency: 'SGD',
        minimumFractionDigits: 0,
    }).format(amount)
}

/**
 * Live thousand-separator formatting for money text inputs (integer dollars).
 * Strips non-digits and re-inserts commas so the field reads "1,000,000" as the
 * agent types. Parse back with `parseFloat(value.replace(/,/g, ''))`.
 * Shared by all calculator money fields for a consistent input UX.
 */
export function formatMoneyInput(value: string): string {
    const raw = value.replace(/[^\d]/g, '')
    return raw ? parseInt(raw).toLocaleString('en-SG') : ''
}
