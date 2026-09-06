import markdown from '@ovacanvas/internal/vite/markdown-literals';
import preact from '@preact/preset-vite';
import {defineConfig} from 'vite';
import motionCanvas from '../vite-plugin/src/main';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@ovacanvas/ui',
        replacement: '@ovacanvas/ui/src/main.tsx',
      },
      {
        find: '@ovacanvas/2d/editor',
        replacement: '@ovacanvas/2d/src/editor',
      },
      {
        find: /@ovacanvas\/2d(\/lib)?/,
        replacement: '@ovacanvas/2d/src/lib',
      },
      {find: '@ovacanvas/core', replacement: '@ovacanvas/core/src'},
    ],
  },
  plugins: [
    markdown(),
    preact({
      include: [
        /packages\/ui\/src\/(.*)\.tsx?$/,
        /packages\/2d\/src\/editor\/(.*)\.tsx?$/,
      ],
    }),
    motionCanvas({
      buildForEditor: true,
    }),
  ],
  build: {
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
