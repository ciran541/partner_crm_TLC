import { aiCostUsd } from '@/lib/ai/pricing'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Log one AI call for Admin > AI Spend: counts and cost only, never content.
 * Awaited because a serverless function can freeze once it responds; bounded and
 * fail-soft because tracking must never break a feature.
 */
export async function recordUsage(feature: string, model: string, inputTokens: number, outputTokens: number, failure: string | null) {
    try {
        const { error } = await createAdminClient().from('ai_usage').insert({
            feature, model, failure,
            environment: process.env.VERCEL_ENV ?? 'local',
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cost_usd: aiCostUsd(model, inputTokens, outputTokens),
        }).abortSignal(AbortSignal.timeout(1500))
        if (error) console.error('[ai_usage] not recorded:', error.message)
    } catch (err) {
        console.error('[ai_usage] not recorded:', String(err))
    }
}
