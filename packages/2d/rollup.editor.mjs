import typescript from '@ovacanvas/internal/rollup/typescript.mjs';
import resolve from '@rollup/plugin-node-resolve';
import postcss from 'rollup-plugin-postcss';

export default [
  {
    input: './src/editor/index.ts',
    output: {
      format: 'es',
      sourcemap: true,
      dir: './editor',
    },
    external: [/^@ovacanvas/, /^@?preact/, './index.css'],
    plugins: [
      resolve(),
      postcss({
        modules: true,
        extract: true,
      }),
      typescript({
        tsconfig: './src/editor/tsconfig.build.json',
        compilerOptions: {
          outDir: './editor',
          composite: false,
        },
      }),
    ],
  },
];
