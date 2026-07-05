import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'

// Tests cover the pure financial calculation core (lib/insurance) — the code
// that computes regulated, client-facing numbers. No DOM/framework deps needed.
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('.', import.meta.url)),
        },
    },
    test: {
        include: ['lib/**/__tests__/**/*.test.ts'],
    },
})
