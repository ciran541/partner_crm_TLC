/**
 * Embedding helper for the knowledge engine semantic search.
 *
 * Calls the Supabase `embed` Edge Function (gte-small, 384 dims) server-side.
 * Returns null on any failure so callers degrade gracefully — an article still
 * saves without a vector, and search falls back to full-text.
 *
 * No new env var: the functions URL derives from NEXT_PUBLIC_SUPABASE_URL.
 */

export const EMBEDDING_DIMS = 384

export async function embedText(input: string): Promise<number[] | null> {
    const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!baseUrl || !serviceKey || !input?.trim()) return null

    try {
        const res = await fetch(`${baseUrl}/functions/v1/embed`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ input: input.trim() }),
            signal: AbortSignal.timeout(5000),
        })

        if (!res.ok) return null
        const json = await res.json()
        const embedding = json?.embedding
        if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMS) return null
        return embedding as number[]
    } catch {
        return null
    }
}

/** Build the text we embed for an article — title + content + tags. */
export function articleEmbedInput(title: string, content: string, tags: string[]): string {
    return [title, content, (tags ?? []).join(' ')].filter(Boolean).join('\n')
}
