/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// The one version number, from package.json, stamped into the app at build
// time. Shown in the toolbar — and the visible proof the silent auto-update
// ran: the number changes on its own.
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));

// The renderer is a normal web app. It runs in a browser during development
// (so it can be driven and tested without Electron) and is loaded by the
// Electron shell in production. `base: './'` keeps asset paths relative so the
// built files load correctly from Electron's file:// origin.
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'electron/**/*.test.mjs', 'tools/**/*.test.mjs'],
  },
});
