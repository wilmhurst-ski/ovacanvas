/// <reference types="vitest" />

import motionCanvas from '@ovacanvas/vite-plugin';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [
    motionCanvas.default({
      project: [
        './tests/project.ts',
        './foundation/project.ts',
        './interaction/project.ts',
        './learner/project.ts',
      ],
    }),
  ],
  test: {
    testTimeout: 60000,
    // These suites boot real dev servers and real browsers, and the HMR suite
    // edits a scene on disk that the other suites are also serving. Running
    // the files in parallel makes one suite's edits land as hot updates in
    // another's page, and makes the zero-RAF measurements race for CPU.
    threads: false,
  },
});
