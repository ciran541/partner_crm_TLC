/** Groups logged questions for the admin: same question and same answer together. */

export interface QuestionRow {
    id: string
    question: string
    kind: 'gap' | 'ai' | 'report'
    answer: string | null
    article_ids: string[] | null
    rating: number | null
    created_at: string
}

export interface QuestionGroup {
    question: string
    kind: QuestionRow['kind']
    answer: string | null
    articleIds: string[]
    count: number
    down: number
    up: number
    lastAsked: string
    ids: string[]
}

/** Rows newest first. Marked wrong first, then asked most, then latest. */
export function groupQuestions(rows: QuestionRow[]): QuestionGroup[] {
    const groups = new Map<string, QuestionGroup>()
    for (const r of rows) {
        const key = JSON.stringify([r.kind, r.question.trim().toLowerCase(), r.answer])
        const g = groups.get(key) ?? {
            question: r.question.trim(), kind: r.kind, answer: r.answer, articleIds: r.article_ids ?? [],
            count: 0, down: 0, up: 0, lastAsked: r.created_at, ids: [],
        }
        g.count++
        if (r.rating === -1) g.down++
        if (r.rating === 1) g.up++
        g.ids.push(r.id)
        groups.set(key, g)
    }
    return [...groups.values()].sort((a, b) => b.down - a.down || b.count - a.count || b.lastAsked.localeCompare(a.lastAsked))
}
