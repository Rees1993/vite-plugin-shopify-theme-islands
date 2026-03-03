import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  {
    entry: ['src/runtime.ts'],
    format: ['esm'],
    dts: false,
  },
]);
