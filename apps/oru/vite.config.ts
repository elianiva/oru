import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { foldkit } from '@foldkit/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { defaultPort } from '@oru/host/cli'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [foldkit(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.join(root, 'src'),
    },
  },
  server: {
    // The app talks to its own origin, so development forwards the RPC paths to
    // the host instead of making the browser cross an origin boundary. The
    // target follows `ORU_PROXY_TARGET`, which is how the browser suite points
    // its own dev server at the host it started.
    proxy: {
      '/rpc': process.env.ORU_PROXY_TARGET ?? `http://127.0.0.1:${String(defaultPort)}`,
    },
  },
})
