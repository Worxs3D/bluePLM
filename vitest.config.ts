import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: that config loads the Electron
// plugins, which would try to build the main process during a unit test run.
export default defineConfig({
  test: {
    // Node by default. A component test opts into a DOM per file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: [
      'api/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'electron/**/*.test.ts',
      'scripts/**/*.test.ts',
    ],
  },
  // Mirrors the alias in vite.config.js. Without it any module under test that
  // imports through '@/' fails to resolve, which rules out most of src.
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
