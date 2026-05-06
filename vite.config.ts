import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    /** If 5173 is busy, exit with an error instead of jumping to 5174. */
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/anica-login-api': {
        target: 'https://chatanicaappep2.azurewebsites.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anica-login-api/, '') || '/',
      },
    },
  },
  /** Same /api proxy when using `vite preview` so Models & dashboard work with `npm run server`. */
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
