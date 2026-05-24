/**
 * Formats a date string for display.
 * Keeps existing en-US locale and format behavior from the original codebase.
 */
export function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    })
}
