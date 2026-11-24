/** Claude list prices (US$ per 1M tokens), checked 24 Nov 2026. Pure. */
const PRICES: Record<string, { in: number; out: number; longIn?: number; longOut?: number }> = {
    // Haiku charges more when one request sends over 100K tokens.
    'claude-haiku-5-5': { in: 0.10, out: 0.50, longIn: 0.50, longOut: 2.50 },
    'claude-sonnet-5-5': { in: 2, out: 10 },
}
const LONG_PROMPT = 100_000

/** Cost of one call, or null for a model with no price listed here. */
export function aiCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
    if (model.startsWith('gemini-')) return 0   // free tier
    const p = PRICES[model]
    if (!p) return null
    const long = inputTokens > LONG_PROMPT
    return (inputTokens * ((long && p.longIn) || p.in) + outputTokens * ((long && p.longOut) || p.out)) / 1_000_000
}
