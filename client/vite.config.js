import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // maplibre-gl loads its renderer in a web worker. Vite's dependency
  // pre-bundler rewrites the worker entry and then cannot find it
  // ("maplibre-gl-worker.mjs does not exist"), so the Map constructor
  // throws at runtime. Excluding it leaves the package to load its own
  // worker exactly as shipped.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
