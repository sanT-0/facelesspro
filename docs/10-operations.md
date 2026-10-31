# 10 — Operations

Running it, keeping it cheap, and knowing what broke.

---

## 1. Local run

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate

cd services/media
python -m venv .venv
.venv/Scripts/activate        # Windows
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

cd ../..
npm run dev:api        # :3001
npm run dev:worker     # consumes steps
npm run dev:web        # :3000
```

Checks:

```bash
curl localhost:3001/health          # {status:"ok", db:"ok", queue:"ok"}
curl localhost:8000/health          # media service + active engine
npm run ping                        # enqueue a job; exit 0 = the worker completed it
npm run gate
```

`/health` is `200` only when every component is `ok`; otherwise it is `503` and the body says
which one failed (`"db":"error"` / `"queue":"error"`). The queue probe checks that all seven
expected definitions exist in the `pgboss` schema: five video steps, `build-art-style`, and
`ping`. It fails before pg-boss has initialised the schema, but it does **not** prove a worker is
actively consuming; `npm run ping` is that artifact check.

**Minimum viable local setup, no keys, no GPU:** Postgres + api + worker + media. Images come
from the procedural renderer when `IMAGE` is unset (or when every adapter named in `IMAGE` is
unconfigured), plans from the heuristic splitter if no LLM key exists, narration from edge-tts.
Slow and plain, but it produces a real video.

**Image engine order:** `IMAGE=cloudflare,pollinations,comfyui,procedural` is tried left to right
and the first success wins; the result's `degradedFrom` names providers that failed at runtime. A
provider skipped for missing credentials/workflow logs a warning and is *not* degradation. To spend
nothing, leave the hosted keys empty — the chain still completes on `procedural`.

**Optional local GPU images:** start ComfyUI (default `127.0.0.1:8188`), export a workflow in API
format, replace its positive/negative/seed/width/height values with the five placeholders in
`fixtures/workflows/comfyui-sdxl-api.json`, then set `COMFYUI_WORKFLOW` and `COMFYUI_OUTPUT_NODE`.
The fixture names `sd_xl_base_1.0.safetensors` as an example only; FacelessPro does not download a
checkpoint or custom node. Keep plain HTTP on loopback/private networks; use HTTPS across machines.

---

## 2. Storage

| Mode | `STORAGE=disk` | `STORAGE=s3` |
|---|---|---|
| Where | `$DATA_DIR` (`./.data`) | any S3-compatible bucket (R2/MinIO/S3) |
| Public URLs | api static route `/files/*` | CDN / bucket public prefix |
| Cleanup | `npm run prune -- --older-than 30d` | lifecycle rule |

Completed renders must have a **stable, unauthenticated** URL (parity). Everything else can
expire. Suggested retention: renders 90 days, intermediate frames 14 days, source uploads 7 days.

---

## 3. Cost control (free-tier survival)

| Lever | Default | Effect |
|---|---|---|
| `IMAGE_CONCURRENCY` | 3 | stays under free rate limits |
| `TTS_CONCURRENCY` | 6 | edge-tts tolerates more; IndicF5 wants 1 |
| `MAX_VIDEO_MINUTES` | 30 | caps render time and credit burn |
| `MAX_SCENES` | 120 | caps image count per video |
| per-run TTS cache | on (`TTS_CACHE=0` disables) | retries and unchanged scenes cost nothing |
| `TTS_CACHE_MAX_MB` | 2048 | oldest entries pruned when a write goes over budget |
| `TTS_CACHE_DIR` | `<MEDIA_DATA_DIR>/cache` | entry = `<sha256>.audio` + `<sha256>.json` |
| `GET /cache` | — | hits / misses / writes / entries / bytes |
| per-scene image cache | on, keyed by prompt+seed | a redraw is cheap, a retry is free |
| `speed=slow` batching | off | 10% cheaper parity behaviour for image gen |
| `npm run usage` | — | prints per-step cost for the last N videos |

**Watch item:** free image quotas are the real bottleneck. 35 scenes/video × 3 videos/day
exceeds most free tiers. Options, all optional: local ComfyUI, Cloudflare top-up (~$5), or an
authenticated Pollinations key for drafts. The legacy keyless Pollinations endpoint is not used:
its visible provider watermark remains even when `nologo=true`.

---

## 4. Failure playbook

| Symptom | First check | Likely fix |
|---|---|---|
| Video stuck at `create-images` | `job_event` for that video, adapter field | provider 429 → lower concurrency, or switch `IMAGE=` order |
| `failed` at `create-vocal`, "no word boundaries" | engine reported no timings | force alignment fallback is enabled? |
| Captions drift after 2 minutes | audio resampled after timing was computed | re-probe durations *after* stitching, never before |
| Tamil text renders as boxes | font not found by libass | `FONTCONFIG_FILE=./packages/art/fonts/fonts.conf` (shipped in P4); run the glyph test |
| Seam / click between voices | gap calibration or cross-fade length | re-run `sample:tts` and listen |
| Webhook never arrives | `webhook_event` table | non-2xx or slow receiver; check `attempts`/`next_at` |
| `402` in self-host | `PLAN=selfhost` not set | set it, or grant credits in the ledger |
| Render OOM at 4K | filter graph holding frames | raise `ffmpeg` memory, or render in scene chunks then concat |

Every failure path writes `error` + `step` + the stderr tail (for ffmpeg) into the video row, so
the editor can show it and `curl /v1/videos/:id` returns it.

---

## 5. Backups

- Postgres: nightly `pg_dump`, 14 daily + 4 weekly.
- Storage: bucket versioning or rsync of `$DATA_DIR`.
- Restore drill once per release: restore dump into a scratch DB, run `GET /v1/videos/:id` for a
  known video, confirm the render URL still resolves.

---

## 6. Upgrade procedures

| Change | Steps | Risk |
|---|---|---|
| Swap an engine adapter | edit `.env` order, restart worker | low — next job uses it |
| Bump an image/text model | edit `data/engines.json`, run visual regression | medium — style drift |
| Change a planner prompt | edit `data/prompts/*.json`, run `fixtures/scripts` snapshots | medium — scene quality |
| Add a caption template | add row, no deploy | none |
| Schema migration | `db:migrate` (forward-only), deploy api before worker | medium — deploy order matters |
| Change the credit table | edit `data/pricing.json` (versioned), never hardcode | none |

---

## 7. Logging

Structured JSON, one line per event:

```jsonc
{"ts":"…","level":"info","svc":"worker","videoId":"…","step":"create-vocal",
 "adapter":"edge","runs":37,"ms":61230,"chars":4980,"costUnits":0}
```

No script text in logs by default (`LOG_SCRIPTS=0`) — user narration is private. Enable only
while debugging, locally.

---

## 8. Health & limits summary

```
GET /health          api: {status, service, version, time, db, queue}   — 503 when degraded
GET /health/media    media: {engine, models, ffmpeg, fonts}
GET /health/fonts    fonts: {notoSans, notoSansTamil, shaping:"ok"}
```

`media` and `storage` are not in the api report yet: they are absent rather than reported as
`ok` before the ports exist. The api's `queue` field is the pg-boss schema check described in
§1, not a media probe.

`/health/fonts` exists because "Tamil renders as boxes" is the single most likely production
surprise, and it should be detectable without rendering a video.
