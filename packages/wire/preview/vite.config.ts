import {defineConfig} from 'vite';

// Served by `@ovacanvas/wire/node`'s PreviewRenderer, never by hand.
export default defineConfig({
  root: __dirname,
  logLevel: 'error',
  server: {host: '127.0.0.1', strictPort: false},
});
