import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The gateway API runs on :8080; proxying keeps the browser on one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': 'http://127.0.0.1:8080', '/zide.js': 'http://127.0.0.1:8080' },
  },
})
