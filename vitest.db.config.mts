import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

/**
 * Integration tests that talk to the real Supabase project (`*.dbtest.ts`).
 *
 * Kept out of the default config on purpose: `npm test` stays pure, fast and
 * offline, and these only run when you ask for them with `npm run test:db`.
 * Being a separate config rather than an env-var gate means it works the same
 * on Windows and CI without a cross-env dependency.
 *
 * These are READ-ONLY against the database. Credentials come from .env.local.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('.', import.meta.url)),
        },
    },
    test: {
        include: ['lib/**/__tests__/**/*.dbtest.ts'],
        // A network round trip per assertion group; the 5s default is tight.
        testTimeout: 30_000,
        hookTimeout: 60_000,
    },
})
