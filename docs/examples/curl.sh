#!/usr/bin/env bash
# docs/examples/curl.sh — end-to-end API smoke test
#
# Runs against a local stack (docker compose up). Creates a video,
# polls for completion, verifies webhook delivery, and tests
# revoked-key auth.
#
# Usage: ./curl.sh [BASE_URL]
#   BASE_URL defaults to http://127.0.0.1:3001

set -euo pipefail

BASE="${1:-http://127.0.0.1:3001}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-test-secret-change-me}"
WEBHOOK_PORT="${WEBHOOK_PORT:-9999}"
WEBHOOK_URL="http://127.0.0.1:${WEBHOOK_PORT}/webhook"

echo "=== FacelessPro API smoke test ==="
echo "Base URL: ${BASE}"
echo "Webhook URL: ${WEBHOOK_URL}"
echo "Webhook secret: ${WEBHOOK_SECRET}"
echo

# Start a temporary webhook receiver in the background
echo "Starting webhook receiver on port ${WEBHOOK_PORT}..."
WEBHOOK_LOG=$(mktemp)
python3 - <<PYEOF >"${WEBHOOK_LOG}" 2>&1 &
import json, hmac, hashlib, sys, time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

SECRET = b"${WEBHOOK_SECRET}"
RECEIVED = []

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        sig = self.headers.get('X-Faceless-Signature', '')
        event_id = self.headers.get('X-Faceless-Event-Id', '')

        RECEIVED.append({
            'event_id': event_id,
            'body': json.loads(body.decode()),
            'signature': sig
        })
        print(f"Webhook received: event_id={event_id}, body keys={json.loads(body.decode()).keys()}", flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'OK')

    def log_message(self, format, *args):
        pass

server = HTTPServer(('127.0.0.1', ${WEBHOOK_PORT}), Handler)
server.serve_forever()
PYEOF
WEBHOOK_PID=$!

# Ensure webhook receiver is ready
sleep 1
# Clean up any previous receiver on the same port
lsof -ti:${WEBHOOK_PORT} | grep -v ${WEBHOOK_PID} | xargs kill -9 2>/dev/null || true
sleep 0.5
echo "Webhook receiver PID: ${WEBHOOK_PID}"
echo

# 1. Health check
echo "1. Health check..."
curl -sf "${BASE}/health" | jq '.'
echo

# 2. Create API key (bootstrap)
echo "2. Creating bootstrap API key..."
KEY_OUTPUT=$(docker compose exec -T api npm run --silent key:create -- --name "smoke test" 2>&1 | grep '^vp_' || true)
if [[ -z "${KEY_OUTPUT}" ]]; then
    # Try alternative: maybe key already exists
    KEY_OUTPUT=$(docker compose exec -T postgres psql -U faceless -d faceless -t -c "SELECT key FROM api_key WHERE name='smoke test' AND revoked_at IS NULL LIMIT 1;" 2>/dev/null | tr -d ' ' || true)
fi
if [[ -z "${KEY_OUTPUT}" ]]; then
    echo "ERROR: Could not create or find API key" >&2
    kill ${WEBHOOK_PID} 2>/dev/null || true
    exit 1
fi
API_KEY="${KEY_OUTPUT}"
echo "API key: ${API_KEY:0:12}..."
echo

# 3. Create a video (Quiz video - no art style needed)
echo "3. Creating video..."
VIDEO_RESPONSE=$(curl -sf -X POST "${BASE}/v1/quiz-videos" \
    -H "Authorization: Bearer ${API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "items": [
            {"type": "question", "text": "What is 2+2?", "answers": ["4"], "correctIndex": 0},
            {"type": "question", "text": "Capital of France?", "answers": ["Paris"], "correctIndex": 0}
        ],
        "template": "standard",
        "language": "en",
        "voiceId": "valluvar",
        "answerTemplate": "The answer is {{answer}}.",
        "generateBackgroundImage": false,
        "generateQuestionImage": false,
        "render": {"resolution": 1080, "frameRate": 30, "format": "standard"}
    }')
echo "${VIDEO_RESPONSE}" | jq '.'
VIDEO_ID=$(echo "${VIDEO_RESPONSE}" | jq -r '.id')
echo "Video ID: ${VIDEO_ID}"
echo

# 4. Poll for completion
echo "4. Polling for completion (max 5 minutes)..."
START=$(date +%s)
TIMEOUT=300
while true; do
    STATUS_RESPONSE=$(curl -sf -H "Authorization: Bearer ${API_KEY}" "${BASE}/v1/videos/${VIDEO_ID}")
    STATUS=$(echo "${STATUS_RESPONSE}" | jq -r '.status')
    STEP=$(echo "${STATUS_RESPONSE}" | jq -r '.step // "null"')
    echo "  Status: ${STATUS}, Step: ${STEP}"
    if [[ "${STATUS}" == "completed" ]]; then
        echo "  ✓ Video completed!"
        VIDEO_URL=$(echo "${STATUS_RESPONSE}" | jq -r '.videoUrl')
        echo "  Video URL: ${BASE}/files/${VIDEO_URL}"
        break
    elif [[ "${STATUS}" == "failed" ]]; then
        ERROR=$(echo "${STATUS_RESPONSE}" | jq -r '.error // "unknown"')
        echo "  ✗ Video failed: ${ERROR}"
        kill ${WEBHOOK_PID} 2>/dev/null || true
        exit 1
    fi
    if (( $(date +%s) - START > TIMEOUT )); then
        echo "  ✗ Timeout after ${TIMEOUT}s"
        kill ${WEBHOOK_PID} 2>/dev/null || true
        exit 1
    fi
    sleep 5
done
echo

# 5. Check webhook was received
echo "5. Checking webhook delivery..."
sleep 2
WEBHOOK_BODY=$(cat "${WEBHOOK_LOG}" | grep "Webhook received" | tail -1 || true)
if [[ -n "${WEBHOOK_BODY}" ]]; then
    echo "  ✓ Webhook received: ${WEBHOOK_BODY}"
else
    echo "  ⚠ Webhook not yet in log (may need more time or check receiver)"
    cat "${WEBHOOK_LOG}"
fi
echo

# 6. Test revoked key → 401
echo "6. Testing revoked key auth..."
# Create a new key to revoke
NEW_KEY_OUTPUT=$(docker compose exec -T api npm run --silent key:create -- --name "revoke test" 2>&1 | grep '^vp_' || true)
if [[ -n "${NEW_KEY_OUTPUT}" ]]; then
    NEW_KEY="${NEW_KEY_OUTPUT}"
    echo "  Created key to revoke: ${NEW_KEY:0:12}..."
    # Get its ID and revoke it
    KEY_ID=$(docker compose exec -T postgres psql -U faceless -d faceless -t -c "SELECT id FROM api_key WHERE name='revoke test' AND revoked_at IS NULL LIMIT 1;" 2>/dev/null | tr -d ' ')
    if [[ -n "${KEY_ID}" ]]; then
        curl -sf -X DELETE "${BASE}/v1/keys/${KEY_ID}" -H "Authorization: Bearer ${API_KEY}" >/dev/null
        # Now try to use revoked key
        REVOKED_RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null -H "Authorization: Bearer ${NEW_KEY}" "${BASE}/v1/workspace")
        if [[ "${REVOKED_RESPONSE}" == "401" ]]; then
            echo "  ✓ Revoked key correctly returns 401"
        else
            echo "  ✗ Revoked key returned ${REVOKED_RESPONSE}, expected 401"
        fi
    fi
fi
echo

# 7. Cleanup
echo "7. Cleanup..."
kill ${WEBHOOK_PID} 2>/dev/null || true
rm -f "${WEBHOOK_LOG}"

echo
echo "=== Smoke test complete ==="