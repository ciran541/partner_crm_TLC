// Supabase Edge Function: text → embedding using the built-in gte-small model.
// Free, runs on Supabase infra, 384-dimensional vectors. No external API key.
//
// Deploy: supabase functions deploy embed
// Called server-side from the Next.js knowledge routes with the service-role key.

// @ts-nocheck — this file runs in the Supabase Edge (Deno) runtime, not Next.js.
// The `Supabase.ai` global and Deno APIs are provided by that runtime.

const model = new Supabase.ai.Session('gte-small')

Deno.serve(async (req) => {
    try {
        const { input } = await req.json()

        if (!input || typeof input !== 'string' || input.trim().length === 0) {
            return new Response(JSON.stringify({ error: 'Missing "input" string' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            })
        }

        // gte-small → 384-dim vector. mean_pool + normalize is the standard config.
        const embedding = await model.run(input, { mean_pool: true, normalize: true })

        return new Response(JSON.stringify({ embedding }), {
            headers: { 'Content-Type': 'application/json' },
        })
    } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        })
    }
})
