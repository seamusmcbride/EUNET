import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative URLs so the build works from any folder, not just the site root
  base: './',
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        immersive: resolve(import.meta.dirname, 'immersive/index.html'),
        editorial: resolve(import.meta.dirname, 'editorial/index.html'),
        playful: resolve(import.meta.dirname, 'playful/index.html'),
        blocks: resolve(import.meta.dirname, 'blocks/index.html'),
      },
    },
  },
});
