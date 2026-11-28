# 10 — Operations

Running it, keeping it cheap, and knowing what broke.

---

## 1. Local run

For the copy-paste version of this section — start, stop, reset, URLs, first key — see
[START-HERE.md](../START-HERE.md). Host development:

```bash
cp .env.example .env
# Host dev serves the studio at :3000; compose serves it at :3003. PUBLIC_BASE_URL
# is the origin a browser opens, so it must match the studio you are running.
sed -i 's|PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=http://localhost:3000|' .env

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
npx tsx scripts/e2e-video.ts        # P5 gate: real video through all five steps, no keys
npx tsx scripts/e2e-video.ts --rerender  # + 1080p/60 re-render, old mp4 kept, doubled render charge
npx tsx scripts/e2e-video.ts --dry-run   # estimate scenes/duration only, no services
```

`/health` is `200` only when every component is `ok`; otherwise it is `503` and the body says
which one failed (`"db":"error"` / `"queue":"error"`). The queue probe checks that all seven
expected definitions exist in the `pgboss` schema: five video steps, `build-art-style`, and
`ping`. It fails before pg-boss has initialised the schema, but it does **not** prove a worker is
actively consuming; `npm run ping` is that artifact check.

**API keys.** Every `/v1` route needs `Authorization: Bearer vp_…`, so the first key is
minted from the host:

```bash
npm run key:create -- --name "CI renderer"        # default: dev workspace
npm run key:create -- --name "CI renderer" --workspace <uuid>
```

The secret is printed once; only `sha256(key)` reaches Postgres. Rotate by creating a new key and
revoking the old one, and remember that revocation is immediate and final. Create the replacement
before revoking the last active key — otherwise every `/v1` route is locked until `key:create`
runs on the host again:

```bash
curl -H "Authorization: Bearer $FACELESS_API_KEY" localhost:3001/v1/keys
curl -X DELETE -H "Authorization: Bearer $FACELESS_API_KEY" \
     localhost:3001/v1/keys/<uuid>
```

With the api running and a key in `FACELESS_API_KEY`, `npm run e2e:keys` is the artifact check:
it creates a key through HTTP, verifies the stored row is `sha256(token)`, revokes it twice
(same timestamp), and proves the revoked token is `401`. `npm run e2e:auth` is the companion
scoping check: it creates a second workspace and proves its key gets `404` for the first
workspace's video and private art style, then proves a revoked key is `401` on the video route.

**Minimum viable local setup, no keys, no GPU:** Postgres + api + worker + media. Images come
from the procedural renderer when `IMAGE` is unset (or when every adapter named in `IMAGE` is
unconfigured), plans from the heuristic splitter if no LLM key exists, narration from edge-tts.
Slow and plain, but it produces a real video. Adding a local Ollama model and a ComfyUI
checkpoint upgrades that to model-written English scene descriptions (`PLANNER_DESCRIBE=ollama`)
and real generated frames, still without a key; a CPU-only ComfyUI is slow but works.

**Image engine order:** `IMAGE=cloudflare,pollinations,comfyui,procedural` is tried left to right
and the first success wins; the result's `degradedFrom` names providers that failed at runtime. A
provider skipped for missing credentials/workflow logs a warning and is *not* degradation. To spend
nothing, leave the hosted keys empty — the chain still completes on `procedural`.

**Optional local images (GPU, or CPU while you wait):** start ComfyUI (default `127.0.0.1:8188`),
export a workflow in API format, replace its positive/negative/seed/width/height values with the
five placeholders in `fixtures/workflows/comfyui-sdxl-api.json`, then set `COMFYUI_WORKFLOW` and
`COMFYUI_OUTPUT_NODE`. `fixtures/workflows/comfyui-sd15-api.json` is a complete SD1.5 shape that
works on CPU: it samples at half the requested geometry and refines at full size, because SD1.5
repeats subjects when asked for 1024px directly. Expect roughly 8–9 minutes per 1024×576 frame
on eight CPU threads, so set `COMFYUI_TIMEOUT_MS` above the default and keep the chain ending in
`procedural`. The fixtures name example checkpoints only; FacelessPro does not download a model
or a custom node. Keep plain HTTP on loopback/private networks; use HTTPS across machines.

### 1.1 Whole stack in compose

One command builds and starts everything (Postgres, media, api, worker, render, mcp, web):

```bash
npm run up                             # docker compose up -d --build
npm run status                         # docker compose ps — every service (healthy)
curl localhost:3001/health             # {"status":"ok","db":"ok","queue":"ok"}
curl localhost:3003/health             # web + nginx proxy
```

| Task | Command | Same as |
|---|---|---|
| start / rebuild changed code | `npm run up` | `docker compose up -d --build` |
| start one service | `npm run up -- worker` | `docker compose up -d --build worker` |
| stop, keep the database and renders | `npm run down` | `docker compose down` |
| stop and delete database + renders | `npm run reset` | `docker compose down -v` |
| status | `npm run status` | `docker compose ps` |
| follow all logs | `npm run logs` | `docker compose logs -f --tail=100` |
| follow one service | `docker compose logs -f worker render` | |
| mint an API key | `npm run key -- --name "local"` | `docker compose exec -T api …create-api-key.ts` |

`npm run up` rebuilds only what changed; the Docker layer cache makes a no-change restart take a
few seconds. Editing `.env` does **not** need a rebuild — `docker compose up -d` recreates the
affected containers with the new values.

| Service | Host port | What it is |
|---|---|---|
| `postgres` | 5433 → 5432 | dev database (host port 5433 so a local Postgres on 5432 keeps working) |
| `media` | 8000 | FastAPI TTS/ASR service |
| `api` | 3001 | Hono API (`/v1`, `/files`, `/health`) |
| `worker` | — (9090 health) | pipeline steps + webhook delivery (`RENDER_SERVICE=worker`) |
| `render` | — (9091 health) | dedicated render consumer (`RENDER_SERVICE=true` → render only) |
| `mcp` | 3002 | MCP server |
| `web` | 3003 → 80 | nginx-served SPA; proxies `/v1/*` and `/files/*` to `api` |

Open the studio at **<http://localhost:3003>**. `PUBLIC_BASE_URL` must be that same origin, because
it is used for `editorUrl` and for the absolute `videoUrl`; the api's `:3001` also answers requests,
but it does not serve the editor. `docker-compose.yml` defaults it to `http://localhost:3003`.

**The compose stack reads the repo-root `.env`.** `docker-compose.yml` interpolates the optional
provider credentials (`CLOUDFLARE_*`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `POLLINATIONS_API_KEY`,
`AZURE_SPEECH_*`), the engine chains (`PLANNER`, `IMAGE`, `STYLE`, `TTS`), `WEBHOOK_SECRET` and the
rate limits, so editing `.env` and running `docker compose up -d` is enough — no rebuild. An empty
credential means "skip that provider"; the chain still ends on a free adapter.

**Ollama and ComfyUI run on the host, not in compose.** Inside a container `127.0.0.1` is the
container, so compose points `OLLAMA_BASE_URL`/`COMFYUI_URL` at `host.docker.internal` (via
`extra_hosts: host-gateway`). Override with `OLLAMA_BASE_URL_DOCKER`/`COMFYUI_URL_DOCKER` if the
service runs on the compose network instead.

**The `worker` and `render` split is real.** `RENDER_SERVICE` selects which queues a process
consumes: unset = every step + webhooks (single-process dev), `worker` = pipeline steps + webhooks,
`render`/`true` = the `render` step only. Both consuming every queue made two consumers race for
each job and deliver every webhook twice.

Mint the first key against the compose database, then use it through the web UI or the API. The
container command needs no host `npm install`, which is what makes a fresh clone work:

```bash
docker compose exec -T api node_modules/.bin/tsx packages/db/src/create-api-key.ts --name "local"

# host alternative, when dependencies are already installed
DATABASE_URL=postgresql://faceless:faceless@127.0.0.1:5433/faceless \
  npm run key:create -- --name "local"
```

Every container runs its entrypoint through **tsx** (`node_modules/.bin/tsx`), the same runner as
`npm run dev`. The repo uses extensionless relative imports with `moduleResolution: bundler`;
plain `node apps/api/src/server.ts` cannot resolve those and fails with `ERR_MODULE_NOT_FOUND`.
Each entrypoint first calls `packages/db/src/prepareDatabase()` (advisory lock → migrate → seed),
so four services booting at once serialise their migrations instead of racing on `CREATE TYPE`,
and the dev workspace exists before the first key is minted.

**Fonts live inside the images, never on a volume.** `BUNDLED_CAPTION_FONTS_URL` resolves to
`/app/packages/art/fonts/ttf/`, and the runtime images contain no system font catalog
(`fc-list` is empty). Any renderer that forgets to pass those files does not fail — it silently
draws no text. Captions go through libass with `fontsdir`. Chat-skin text does not use SVG
`<text>` at all: resvg gives every Tamil cluster ending in a reordered vowel sign (ே ை ொ ோ ௌ)
a zero advance, so the next word is drawn on top of it. `packages/art/src/text-path.ts` shapes
with HarfBuzz (wasm) and emits glyph `<path>` elements, which resvg only fills; libass on the
caption path proves HarfBuzz gets the same text right.


**The `media-data` volume must be mounted at the same path in `media`, `worker` and `render`.**
The media service answers with absolute `master_mp3_path` values; the worker opens that path
directly instead of re-downloading audio. `media` writes `/data/media`, and `worker`/`render`
mount the same volume there read-only.

**`npm run test:db` needs the consumers paused.** The suite and the compose `worker`/`render`
share one Postgres, and pg-boss queue names are global, so a running consumer can take the job a
test just enqueued and make a correct commit look like a timeout:

```bash
docker compose stop worker render api mcp
npm run test:db
docker compose start worker render api mcp
```

---

## 2. Storage

**Only the local disk backend is implemented.** Files live under `$DATA_DIR` (`./.data`) and the
api serves them at `/files/*`. The `STORAGE=s3` mode and the `S3_*` variables are reserved for the
S3/CDN backend; they are not read yet, so setting them changes nothing.

| Mode | `STORAGE=disk` (implemented) | `STORAGE=s3` (reserved) |
|---|---|---|
| Where | `$DATA_DIR` (`./.data`) | any S3-compatible bucket (R2/MinIO/S3) |
| Public URLs | api static route `/files/*` | CDN / bucket public prefix |
| Cleanup | `npm run prune -- --older-than 30d` | lifecycle rule |

Completed renders must have a **stable, unauthenticated** URL (committed behaviour). Everything
else can expire. Suggested retention: renders 90 days, intermediate frames 14 days, source uploads 7 days.

---

## 3. Cost control (free-tier survival)

| Lever | Default | Effect |
|---|---|---|
| `IMAGE_CONCURRENCY` | 3 (reserved) | P5.3 is intentionally sequential so the cross-scene guard sees every accepted prior frame; bounded provider batching has not landed yet |
| `TTS_CONCURRENCY` | 6 | edge-tts tolerates more; IndicF5 wants 1 |
| `MAX_VIDEO_MINUTES` | 30 | caps render time and credit burn |
| `MAX_SCENES` | 120 | caps image count per video |
| `RATE_LIMIT_KEY_PER_MINUTE` | 60 | fixed one-minute window per API key; over the limit → `429` + `Retry-After` |
| `RATE_LIMIT_WORKSPACE_PER_MINUTE` | 300 | fixed one-minute window shared by every key in a workspace |
| `SUBTITLE_UNIT_COST` | 20 | one enabled caption track records one subtitles unit at the committed reference price; selfhost remains unlimited |
| `RENDER_UNIT_COST` | 10 | per-minute render price at 30 fps; a 60 fps render bills double. Duration comes from the stitched narration, not the requested estimate; selfhost remains unlimited |
| per-run TTS cache | on (`TTS_CACHE=0` disables) | retries and unchanged scenes cost nothing |
| `TTS_CACHE_MAX_MB` | 2048 | oldest entries pruned when a write goes over budget |
| `TTS_CACHE_DIR` | `<MEDIA_DATA_DIR>/cache` | entry = `<sha256>.audio` + `<sha256>.json` |
| `GET /cache` | — | hits / misses / writes / entries / bytes |
| per-scene image cache | not implemented yet | deterministic keys make storage retries safe, but a pre-commit retry may still call the provider again |
| `speed=slow` batching | off | 10% cheaper image-gen behaviour, as specified |
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
| Tamil text renders as boxes | font not found by libass | set `FONTCONFIG_FILE=./packages/art/fonts/fonts.conf` or pass `fontsdir=packages/art/fonts/ttf`; run the real-ffmpeg glyph test |
| Emoji renders as a box or is missing | `NotoEmoji-Variable.ttf` not in `fontsdir`, or a host font shadowed the inline `\fnNoto Emoji` | keep the bundled font in `packages/art/fonts/ttf/`; the emoji render test compares two glyphs, so identical tofu fails loudly |
| Seam / click between voices | gap calibration or cross-fade length | re-run `sample:tts` and listen |
| Webhook never arrives | `webhook_event` table | non-2xx or slow receiver; check `attempts`/`next_at` |
| `402` in self-host | `workspace.plan_id` is not `selfhost` | set the row to `selfhost`, or grant credits via `POST /v1/balance/topup`; there is no `PLAN` env var |
| `404` for a video or style you know exists | the key belongs to a different workspace | use the owning workspace's key; cross-workspace ids are deliberately indistinguishable from missing ones |
| `429 rate_limited` from `/v1` | `RATE_LIMIT_KEY_PER_MINUTE` / `RATE_LIMIT_WORKSPACE_PER_MINUTE` | wait for `Retry-After`; raise the limit for trusted automation, or split work across workspaces only when that is actually intended |
| Render OOM at 4K | filter graph holding frames | raise `ffmpeg` memory, or render in scene chunks then concat |
| Thumbnail missing after a completed render | ffprobe/ffmpeg stderr and `<thumbnail>.part` | source MP4 must verify first; retry extraction — `.part` is removed and only a signature/IHDR-verified PNG is published |
| MP4 has video but the voice is silent in a desktop player | `ffprobe` audio profile/channels, then play the extracted WAV/MP3 | renderer must emit AAC-LC, 48 kHz, stereo; mono AAC can decode in ffmpeg yet fail in a playback path — re-render with current profile |

Every failure path writes `error` + `step` + the stderr tail (for ffmpeg) into the video row, so
the editor can show it and `curl /v1/videos/:id` returns it.

Each step attempt also appends one `job_event` row (docs/04 §9) — the video row says *what*
failed, `job_event` says *what the attempt saw*:

```sql
select outcome, attempt, duration_ms, adapter, items, ok, failed, bytes,
       cost_units, degraded_from, error, created_at
from job_event
where video_id = '<uuid>'
order by created_at;
```

`failed` rows carry the same `{code, message}` as the video row; `retryable` rows are
attempts pg-boss was asked to try again; `stale`/`superseded` rows are duplicate deliveries
that were dropped on purpose. Rows are best-effort telemetry — absence of a row is not
evidence that a step did not run.

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

Every service writes **application events** as one JSON object per line to stdout; Docker
captures it, so the sink needs no sidecar. The shared implementation is `@facelesspro/log`.
(The shell entrypoint's short boot banner and the migration runner's progress lines stay plain
text; they are one-off, human-facing, and carry no user data.)

```jsonc
{"ts":"2026-11-25T10:00:00.000Z","level":"info","svc":"facelesspro-worker",
 "event":"step.committed","videoId":"…","step":"create-vocal","ms":61230,"items":37}
```

The first four keys are always present and in this order: `ts` (ISO-8601 UTC), `level`
(`debug`|`info`|`warn`|`error`), `svc`, `event` (a dotted, stable name). Call fields follow and
may add or override a key; `child()` context is merged first, so a call can correct it.

| Event | Service | When |
|---|---|---|
| `http.request` | api | every request except `/health` (debug) and `/files/*` (never) |
| `api.limit_exceeded` | api | a plan cap answers 402/403 |
| `api.unhandled_error` | api | a route threw; the client still sees `internal` |
| `api.listening`, `api.shutdown`, `api.fatal` | api | lifecycle |
| `worker.health_listening`, `worker.consuming`, `worker.draining`, `worker.fatal` | worker | lifecycle |
| `step.failed` | queue | a non-retryable step ended `failed` (the only trace of an internal bug) |
| `job_event.write_failed`, `webhook.event_insert_failed`, `webhook.enqueue_failed`, `queue.boss_error` | queue | telemetry or delivery is degraded; the pipeline keeps going |
| `mcp.listening`, `mcp.shutdown`, `mcp.fatal`, `mcp.unhandled_error` | mcp | lifecycle and JSON-RPC transport failures |

Configuration, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `LOG_LEVEL` | `info` | minimum level; an unknown value falls back to `info` |
| `LOG_SCRIPTS` | `0` | `1` stops redacting narration fields (local debugging only) |
| `LOG_STACKS` | `0` | `1` appends a stack to logged `Error` values |

**User narration is private.** By default any field named `script`, `scripts`, `text`, `texts`,
`narration`, `transcript`, `voiceover`, `prompt`, `body`, `messages` or `conversations` is
replaced with `"[redacted]"` **at any depth**, so a create request cannot leak a whole script
through a stray `request` field. Logging an `Error` keeps `name`, `message` and the `cause`
chain (where adapters put a provider status) but not the stack unless `LOG_STACKS=1`. A
circular value, a bigint or a broken sink can never make a log call throw.

`job_event` remains the durable telemetry table; these lines are the fast path for
`docker compose logs` and for a log-based alert rule.

---

## 7.1 Job dashboard and failure-rate alert

`job_event` is durable per-attempt telemetry; `npm run jobs:health` is the read side.

```console
$ npm run jobs:health
job health · last 60 min · since 2026-11-25T07:23:04.464Z
step              events     ok  failed  retry    rate
create-scenes          0      0       0      0    0.0%
create-vocal           0      0       0      0    0.0%
create-images          2      2       0      0    0.0%
render                 3      2       1      0   33.3%
total                  5      4       1      0   20.0%

status: DEGRADED (threshold 20.0% terminal failure rate)
```

- **Window:** first positional argument, in minutes (`npm run jobs:health -- 180`), or
  `JOB_HEALTH_WINDOW_MINUTES`. Default 60.
- **Scope:** `--workspace <uuid>` limits the report to one workspace's videos; without it the
  report covers the install.
- **Alert:** `JOB_FAILURE_THRESHOLD` (default `0.2`) is the terminal failure rate above which
  the exit code is `1`. Wire it to cron or an Uptime-Kuma push monitor:
  `*/10 * * * * cd /srv/facelesspro && npm run jobs:health >/var/log/jobs-health.txt 2>&1 || notify`.
  Exit `2` means the database could not be read — also worth an alert.
- **Arithmetic:** rate = `failed / (succeeded + failed)`, where success is `committed` or
  `reused`. `retryable` is shown but is not a failure: pg-boss has not given up yet. `stale`,
  `locked`, `superseded` and `missing` are coordination noise and never move the rate. A step
  with no terminal attempt in the window is `0 %`, not `100 %`.
- Every step is printed in pipeline order with zeros included; a missing row would otherwise
  read as "healthy".

The same report shape is `jobHealthSchema` in `@facelesspro/contracts`, so a future
`/v1/monitoring` route or a web dashboard can reuse the arithmetic instead of re-deriving it.

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
