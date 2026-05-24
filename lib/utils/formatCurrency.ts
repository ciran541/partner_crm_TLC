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
