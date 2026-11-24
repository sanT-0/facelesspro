/**
 * `npm run build --workspace=@facelesspro/web`
 *
 * Produces a plain static bundle nginx can serve: `dist/index.html`,
 * `dist/styles.css` and `dist/bundle.js`. The app is a hand-written SPA, so the
 * bundler's only job is resolving the extensionless relative imports in
 * `src/` — there is no framework build step.
 */

import { copyFile, mkdir } from 'node:fs/promises';

import { build } from 'esbuild';

await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  minify: true,
  sourcemap: true,
  target: 'es2020',
});

await copyFile('src/index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/styles.css');

console.log('[web] built dist/ (index.html, styles.css, bundle.js)');
