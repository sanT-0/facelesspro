#!/bin/sh
# mcp entrypoint — apply committed SQL, then start the service.
#
# Everything runs through tsx (the same runner as `npm run dev`/`npm start`):
# the repo uses extensionless relative imports with `moduleResolution: bundler`,
# which plain `node` cannot resolve.
set -e

echo "[mcp] applying migrations..."
node_modules/.bin/tsx packages/db/src/migrate-on-boot.ts

echo "[mcp] starting..."
exec node_modules/.bin/tsx apps/mcp/src/main.ts
