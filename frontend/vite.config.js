// frontend/vite.config.js

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Aici este magia!
    proxy: {
      // Orice cerere care începe cu '/api'
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    }
  }
})