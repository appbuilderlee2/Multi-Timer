import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/Multi-Timer/',
  build: {
    rollupOptions: {
      input: resolve(process.cwd(), 'app-source.html'),
    },
  },
});
