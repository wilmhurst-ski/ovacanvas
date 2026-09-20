/// <reference types="vitest" />

import {defineConfig, loadEnv} from 'vite';
import {registerAuthoringRoutes} from './src/server/authoringApi';

export default defineConfig(({mode}) => {
  // The empty prefix loads every variable, not just VITE_* - the provider
  // keys are deliberately server-side. Nothing here is re-exported into
  // client code, so no key can reach the browser bundle.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      {
        name: 'ovacanvas-authoring-api',
        configureServer(server) {
          registerAuthoringRoutes(server.middlewares, env);
        },
      },
    ],
    server: {host: '127.0.0.1', port: 5273},
    test: {
      include: ['./src/**/*.test.ts'],
      environment: 'node',
      testTimeout: 60000,
    },
  };
});
