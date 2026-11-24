#!/bin/sh
# Media service entrypoint
set -e

echo "[media] Starting up..."

# Create data directory
mkdir -p /data/media

echo "[media] Starting media service..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000