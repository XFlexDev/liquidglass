import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const src = fileURLToPath(new URL('../src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^liquidglass\/react$/, replacement: `${src}/react` },
      { find: /^liquidglass\/element$/, replacement: `${src}/element` },
      { find: /^liquidglass\/css$/, replacement: `${src}/liquidglass.css` },
      { find: /^liquidglass$/, replacement: `${src}/index.ts` },
    ],
  },
  server: { fs: { allow: ['..'] } },
})
