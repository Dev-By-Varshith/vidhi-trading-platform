import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Serve the public Arrow/binary tick dataset
  publicDir: 'public',

  server: {
    port: 5173,
    // ── COOP/COEP headers required for SharedArrayBuffer (Arrow wasm) ────────
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // ── Proxy all /api/* and /ws/* to the Go backend ─────────────────────────
    proxy: {
      '/api': {
        target:       'http://localhost:8080',
        changeOrigin: true,
        secure:       false,
      },
      '/ws': {
        target:    'ws://localhost:8080',
        ws:        true,
        changeOrigin: true,
      },
    },
  },

  // Ensure worker files are handled correctly
  worker: {
    format: 'es',
  },
})
