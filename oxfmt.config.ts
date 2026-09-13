import { defineConfig } from 'oxfmt'

export default defineConfig({
  ignorePatterns: [
    '.agent/**',
    '.agents/**',
    '.claude/**',
    '.codex/**',
    '.continue/**',
    '.cursor/**',
    '.gemini/**',
    '.opencode/**',
    '.pi/**',
    '.roo/**',
    '.windsurf/**',
    'dist/**',
    '.turbo/**',
    'tools/oxlint/anti-slop/**',
  ],
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
})
