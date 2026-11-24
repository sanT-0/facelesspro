#!/bin/sh
# render entrypoint — apply committed SQL, then start the service.
#
# Everything runs through tsx (the same runner as `npm run dev`/`npm start`):
# the repo uses extensionless relative imports with `moduleResolution: bundler`,
# which plain `node` cannot resolve.
set -e

echo "[render] applying migrations..."
node_modules/.bin/tsx packages/db/src/migrate-on-boot.ts

echo "[render] starting..."
exec node_modules/.bin/tsx apps/worker/src/main.ts
