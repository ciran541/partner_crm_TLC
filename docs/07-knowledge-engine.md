# 07 – Knowledge Engine

An admin-curated knowledge base (`knowledge_articles`) that agents query through search and a grounded AI assistant. The defining product constraint: **this is not an AI chatbot** — answers must come from our articles or not at all.

## The shape of the feature

- **Admins** write/edit articles at `/admin/insurance/knowledge` (create/update auto-embeds; `/api/admin/knowledge/reindex` backfills embeddings).
- **Agents** get two doors at `/insurance/dashboard/knowledge`:
  - **Search** — relevant article cards (`/api/insurance/knowledge/search`).
  - **Ask** — a natural-language question answered *only* from retrieved articles (`/api/insurance/knowledge/ask`, UI: `components/insurance/knowledge/KnowledgeAsk.tsx`).
- Agents can never list the whole repository — access is search/contextual only, via guarded server routes (the table has RLS on with no client policies).

## Retrieval — one cascade, shared everywhere

`retrieveArticles()` in `lib/insurance/retrieveKnowledge.ts` is the **single** implementation, used by both `/search` and `/ask` (each passes its own threshold/count). Three tiers, best-effort downward:

1. **Semantic**: `embedText()` (`lib/insurance/embed.ts`) calls the Supabase Edge Function `embed` (free `gte-small` model, 384-dim vectors) → `match_knowledge_articles` RPC → pgvector cosine similarity over an HNSW index. Finds articles that *mean* the same thing as the query even with zero shared words.
2. **Full-text**: Postgres text search, if semantic returns nothing usable.
3. **Substring**: plain `ILIKE`, the last resort.

> **Why a cascade:** semantic search needs the embedding service to be up and the query to embed meaningfully; full-text needs word overlap; substring almost always returns *something*. Ordering them means the best available tier answers, and an embedding outage degrades quality instead of breaking the feature.

Query normalization (`normalizeQuery.ts`) cleans up agent phrasing before retrieval; it shares `askGemini.ts`'s `modelChain()`.

## Grounded answers ("Ask")

`/api/insurance/knowledge/ask` retrieves articles, then `composeAnswer()` (`lib/insurance/askGemini.ts`) has Gemini phrase an answer **only from those articles**:

- Nothing relevant retrieved → the assistant **refuses** rather than improvises, and the question is logged to `knowledge_gaps` — turning failed searches into an admin to-do list (`/api/admin/knowledge/gaps`, resolve endpoint marks them handled). A failure mode became a content pipeline.
- `GEMINI_API_KEY` absent or model call fails → degrade to plain article cards. Retrieval never depends on the LLM.

> **Why strict grounding:** agents relay these answers to clients in a regulated domain. A hallucinated "fact" is worse than no answer. The boss's framing is the spec: *"not an AI chatbot."*

## Gemini specifics (learned the hard way, preserved here)

- **Model names live only in `askGemini.ts`'s `modelChain()`.** A model name hardcoded elsewhere once kept calling a retired model for a month, silently degrading retrieval. If you add a Gemini call anywhere, import the chain.
- **Thinking budget:** Gemini 2.5 flash models are "thinking" models whose invisible reasoning tokens can silently truncate a response mid-sentence; `thinkingConfig: { thinkingBudget: 0 }` is set in `askGemini.ts`. Keep it when touching the request payload.
- Free-tier Gemini caps at ~20 requests/day/model — fine for ask-style traffic, and why higher-volume pipelines (news, bank reports) use DeepSeek instead ([08](08-news-and-calendar.md), [09](09-bank-insights.md)).

## Contextual surfacing

`/api/insurance/knowledge/contextual` serves case-context-relevant articles (same retrieval cascade) so knowledge appears where the agent already is, instead of requiring a trip to the knowledge page.

## Deploy note

The embedding Edge Function ships separately from schema changes: `supabase functions deploy embed`. A new environment that runs migrations but forgets this step gets a knowledge engine whose semantic tier silently never fires (the cascade will mask it — check the Edge Function first when search quality feels off).
