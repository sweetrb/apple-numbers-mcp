import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/services/**'],
      exclude: ['src/__tests__/**'],
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
