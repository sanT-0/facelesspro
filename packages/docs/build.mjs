#!/usr/bin/env node
/**
 * Build the static docs site.
 *
 * Output: dist/{openapi.json, index.html}
 */

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(import.meta.dirname, 'dist');

mkdirSync(outDir, { recursive: true });

// Copy the spec
copyFileSync(resolve(import.meta.dirname, 'src/openapi.json'), resolve(outDir, 'openapi.json'));

// Minimal HTML that loads Redoc
const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>FacelessPro API Reference</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #redoc { height: 100vh; }
  </style>
</head>
<body>
  <redoc spec-url="./openapi.json"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`;

writeFileSync(resolve(outDir, 'index.html'), html);

console.log(`Built docs to ${outDir}`);
console.log(`  openapi.json`);
console.log(`  index.html`);