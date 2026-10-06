import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  server: { port: 5199 },
  test: { include: ['test/**/*.test.ts'] },
} as any);
