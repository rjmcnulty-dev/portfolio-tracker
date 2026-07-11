import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works from a GitHub Pages project subpath.
  base: './',
  plugins: [react()],
})
