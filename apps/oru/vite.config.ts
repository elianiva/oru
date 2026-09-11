import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [foldkit(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
})
