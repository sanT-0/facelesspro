import { defineConfig } from 'esbuild';

export default defineConfig({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  minify: false,
  sourcemap: true,
  target: 'es2020',
  loader: {
    '.html': 'copy',
    '.css': 'copy',
  },
});
