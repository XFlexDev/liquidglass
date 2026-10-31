import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      element: 'src/element.ts',
      react: 'src/react.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    external: ['react', 'react-dom'],
  },
  {
    entry: { 'liquidglass.global': 'src/global.ts' },
    format: ['iife'],
    globalName: 'LiquidGlass',
    outDir: 'dist',
    minify: true,
    noExternal: [/.*/],
  },
])
