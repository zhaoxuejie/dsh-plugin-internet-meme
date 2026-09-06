import { defineConfig } from 'tsdown'

/** Host entry plus a dependency-free browser overlay served by that host. */
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: true,
  },
  {
    entry: { bridge: 'src/bridge.ts' },
    outDir: 'lib',
    format: ['iife'],
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    sourcemap: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'bridge.js',
    },
  },
])
