/** Numbers in text as values: "$16,000" → 16000, "1.5m" → 1500000. Safe in the browser. */
const UNIT: Record<string, number> = { k: 1e3, m: 1e6, mil: 1e6, million: 1e6 }
export const figureValues = (s: string) => [...s.toLowerCase().replace(/(\d),(?=\d{3})/g, '$1').matchAll(/(\d+(?:\.\d+)?)\s*(k|mil|million|m)?\b/g)]
    .map(m => parseFloat(m[1]) * (m[2] ? UNIT[m[2]] : 1))

/** What an admin would call a figure: "$16,000", "75%", "30 years". */
export const FIGURE = /\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:%|per cent|k\b|m\b|mil\b|million\b|years?\b|months?\b))?/gi

/** The figures written in an answer (list numbering like "1. " isn't one). */
export const figureTokens = (answer: string) => [...new Set((answer.replace(/^\s*\d+[.)]\s/gm, '').match(FIGURE) ?? []).map(t => t.trim()))]
