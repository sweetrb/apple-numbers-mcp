import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/utils/**'],
      exclude: ['src/services/**'],
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
});
