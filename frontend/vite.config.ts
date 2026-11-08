/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Dev: the backend runs on :8000 (prod container serves API + bundle on :8080).
      // ws: true so the terminal WebSockets (a container's, a machine's) proxy through too.
      '/api': {
        // compose.live.yml points it at the loskai container.
        target: process.env.LOSKAI_API ?? 'http://localhost:8000',
        // Host stays the page's (:5173), so it matches the Origin the backend checks.
        changeOrigin: false,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // Every test's vi.stubGlobal (fetch, mostly) is undone after it.
    unstubGlobals: true,
  },
})
