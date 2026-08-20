import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.spec.ts'],
    exclude: ['build/**', 'dist/**', 'node_modules/**', 'release/**'],
  },
})
