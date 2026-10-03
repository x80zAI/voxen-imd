import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import dataHandler from './api/data.mjs';

export default defineConfig({
  plugins: [react(), {
    name: 'local-public-data',
    configureServer(server) {
      server.middlewares.use('/api/data', (req, res) => { void dataHandler(req, res); });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/data', (req, res) => { void dataHandler(req, res); });
    },
  }],
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 15_000 },
});
