#!/bin/sh
# api entrypoint — apply committed SQL, then start the service.
#
# Everything runs through tsx (the same runner as `npm run dev`/`npm start`):
# the repo uses extensionless relative imports with `moduleResolution: bundler`,
# which plain `node` cannot resolve.
set -e

echo "[api] applying migrations..."
node_modules/.bin/tsx packages/db/src/migrate-on-boot.ts

echo "[api] starting..."
exec node_modules/.bin/tsx apps/api/src/server.ts
