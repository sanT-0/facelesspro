# 03 — Architecture

## 1. Shape

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web  (Next.js 15)                                              │
│   marketing pages · studio · editor · gallery · settings · docs      │
└───────────────┬──────────────────────────────────┬───────────────────┘
                │ same-origin /api/*               │ /mcp (Streamable HTTP)
┌───────────────▼──────────────────────────────────▼───────────────────┐
│  apps/api  (Hono, Node 22)                                           │
│   /v1/*  REST · workspace auth (bearer vp_…) · /mcp · webhooks out    │
│   reads/writes Postgres · enqueues jobs (pg-boss) · returns 202/201   │
└───────────────┬──────────────────────────────────────────────────────┘
                │ pg-boss (Postgres-backed queue, transactional)
┌───────────────▼──────────────────────────────────────────────────────┐
│  apps/worker  (Node)   job = one pipeline step, idempotent           │
└───┬───────────────┬────────────────┬─────────────────┬───────────────┘
    │ HTTP          │ HTTP           │ spawn           │ HTTP
┌───▼──────────┐ ┌──▼───────────┐ ┌──▼────────────┐ ┌──▼──────────────┐
│ services/    │ │ services/    │ │ ffmpeg        │ │ free providers  │
│ media        │ │ render       │ │ (system)      │ │ CF / Groq / …   │
│ TTS · ASR ·  │ │ compose +    │ │               │ │ behind ports    │
│ art profile  │ │ mux + subs   │ │               │ │                 │
└──────────────┘ └──────────────┘ └───────────────┘ └─────────────────┘
         │                │                │
         └────────────────┴────────────────┴──► Storage (disk | S3/R2)
                                                Postgres (state + ledger)
```

**Why a separate Python service:** TTS/ASR/model ecosystem is Python-first, and it lets the
heavy work be a process that can crash without taking the API down. It speaks plain HTTP +
a shared storage volume, so it can be moved to another machine or container unchanged.

**Why pg-boss instead of Redis/BullMQ:** the credit ledger and the job state must agree. If the
queue is the same Postgres database, "mark step done + write ledger row + enqueue next step"
is one transaction. No phantom charges, no distributed lock, one less service to operate.

---

## 2. Packages and boundaries

| Path | Language | Rule |
|---|---|---|
| `packages/core` | TS, **zero deps** | Pure functions only: segmentation, scene math, caption line-breaking, timeline, pricing. No I/O, no network, no clock. Fully unit-testable. |
| `packages/contracts` | TS + zod | Every request/response/DB-row shape. Imported by api, worker, web, mcp. Single source of truth. |
| `apps/worker` | TS | Orchestration + adapters. Calls providers through **ports**. |
| `services/media` | Python | Engines. No business rules, no credits, no DB writes except its own artifact dir. |
| `services/render` | Python | Deterministic ffmpeg composition. Input = timeline JSON. Output = mp4. |

**Ports (hexagonal).** The worker defines the interface; providers are adapters selected by
env/config. This is what makes "free today, better tomorrow" possible without touching the
pipeline.

```ts
// apps/worker/src/ports/
interface PlanFn        { plan(request: PlanRequest): Promise<ScenePlan> }
interface PlannerPort extends PlanFn { readonly name: PlannerAdapter }
interface TTSPort      { synthesize(plan: VoicePlan): Promise<Narration> }
interface ASRPort      { transcribe(audio: Buffer): Promise<WordTimings> }
interface ImagePort    { draw(prompt: ImagePrompt, style: StyleProfile): Promise<Image> }
interface StylePort    { learn(samples: Frame[]): Promise<StyleProfile> }
interface RenderPort   { render(spec: RenderSpec): Promise<Artifact> }
interface StoragePort  { put(key, bytes): Promise<Url>; get(key): Promise<Bytes> }
interface NotifyPort   { deliver(event: WebhookEvent): Promise<DeliveryResult> }
```

`PlannerPort` is the one port built so far (`apps/worker/src/ports/planner.ts`), and it is the
template for the rest: the adapter **names itself** (`name`), returns the stored contract shape
(`ScenePlan`, parsed with zod at the boundary), and the chain — not the adapter — owns
`degradedFrom`, so degradation history is written in one place. Timings are never a model's
output: adapters that ask an LLM for beats still take `startMs`/`endMs` from
`estimateDuration()`/`packScenes()` in `packages/core`.

Adapters: `planner/{cloudflare,groq,ollama,heuristic}`, `tts/{edge,indicf5,piper}`,
`asr/{whisper-local,cloudflare}`, `image/{cloudflare,pollinations,comfyui}`,
`style/{cloudflare,gemini,heuristic}`, `storage/{disk,s3}`.

Selection is **capability-first, not vendor-first**: config says
`PLANNER=cloudflare,groq,heuristic` and the first healthy adapter wins; a failed adapter
degrades to the next one and records why.

The three hosted/local planner transports share one call path (`planner/http.ts`): POST JSON
with an `AbortController` timeout, the provider error body truncated into the message, and one
classification that the chain and the step runner both rely on — **`retryable`**. Network
failure, timeout, `408`, `425`, `429` and `5xx` are retryable; `400`/`401`/`403`/`404`/`422` and a
`200` whose body is not JSON are permanent, because a retry of a rejected request or a bad key
only burns quota. `PlannerChainError.retryable` is true only when **every** adapter failed
transiently; if any failure was permanent the step fails now and the video is not retried in a
loop. Each adapter takes `fetchImpl` by injection, so unit tests never open a socket.
A *rejected answer* is repaired inside the adapter (`planWithRepair`: one re-ask quoting the
violations) before the chain sees it, so `degradedFrom` means "this adapter could not plan", not
"this adapter needed one more prompt"; a *transport failure* is never repaired there.

**`POST /v1/videos/plan` (dry run)** is the estimator, not a model call: the API cuts the script
with the same `packScenes()`/`estimateDuration()`/`scriptLanguagePlan()` layer the worker falls
back to, returns `adapter: "heuristic"`, and charges nothing — no video row, no ledger write, no
socket. It is the floor the video cannot fall below, and `cost` lands with P6 (credits).

---

## 3. Data model (Postgres)

```sql
workspace      (id, name, plan_id, credits, balance_cents, created_at)
member         (workspace_id, user_id, role)              -- owner|admin|editor|viewer
user           (id, email, name, password_hash?)
api_key        (id, workspace_id, name, hash, prefix, last_used_at, revoked_at)
credit_ledger  (id, workspace_id, video_id?, action, units, unit_cost, delta, created_at)
balance_ledger (id, workspace_id, kind, amount_cents, meta, created_at)

art_style      (id, workspace_id?, name, published, formats[], profile jsonb,
                preview_url, portrait_preview_url, sample_video_urls[], status, created_at)
voice          (id, workspace_id?, engine, external_id, name, languages[], meta jsonb)
caption_tpl    (id, workspace_id?, name, spec jsonb)       -- id<0 = built-in
asset          (id, workspace_id, kind, key, bytes, mime, meta, created_at)

video          (id, workspace_id, kind, status, step, error,
                request jsonb, plan jsonb, webhook_url,
                duration_ms, video_url, editor_seen_at, created_at, updated_at)
scene          (id, video_id, idx, text, image_asset_id, motion jsonb, start_ms, end_ms)
narration      (video_id, asset_id, duration_ms, word_timings jsonb, voice_plan jsonb)
caption_track  (video_id, template_id, cues jsonb)
render         (id, video_id, resolution, fps, format, asset_id, status, created_at)

job_lock       (video_id, step, attempt, started_at)  -- resumability guard
webhook_event  (id, video_id, event, attempts, next_at, delivered_at, payload jsonb)
```

`video.request` stores the **normalised** create request, so "retry" and "re-render" replay
the same input without the client resending anything.

Column notes, all encoded in `packages/contracts/src/db.ts`:

- `workspace.credits` is **nullable**: `null` means unlimited (`selfhost`). A Postgres integer
  cannot hold `Infinity` and neither can JSON, so the meaning is carried by the null.
- `voice.id` is **text**, not uuid — engine ids (`ta-IN-PallaviNeural`) are the natural key and
  must survive a re-seed.
- `caption_tpl.id` is an integer; negative ids are built-ins (parity), `0` is never valid.
- `user` is a reserved word in Postgres, but it is the documented table name; Drizzle quotes it.
- `video.step` is nullable once a render completes; the enum is ours
  (`create-scenes`…`render`), not the leaked upstream spelling.
- Every timestamp is `timestamptz` and is a **string** in the database layer, normalised to
  ISO 8601 UTC on the way out (`packages/db/src/timestamp.ts`). Postgres prints
  `2026-10-26 18:12:34.567+00`, which the wire contract rejects; converting once at the
  boundary is cheaper than teaching every client two formats. Microseconds are truncated to
  milliseconds, and `created_at` is not a total ordering (Postgres `now()` is
  transaction-scoped), so paginate with an explicit tiebreaker.
- Only `video_status`, `video_step` and `member_role` are real Postgres enums, built from the
  contract tuples. Adding a step or a status is therefore a migration; adding a plan or an
  image style is not.

Plans are **code, not rows**: there is no plan table, and `workspace.plan_id` is the pointer.
`npm run db:seed` (also run by `db:migrate`) inserts the three built-in caption templates and
one `selfhost` dev workspace with `credits = null`.

### 3.1 Timestamp handling, and why not `pg`'s parser

Drizzle replaces `pg`'s type-parser table with an identity function and maps values per column,
so `types.setTypeParser(1184, …)` never runs for a drizzle query — it looks like a fix and does
nothing. The normalisation therefore lives on the column itself, as a `customType` whose
`fromDriver` returns ISO 8601 UTC. That also keeps `$inferSelect` matching the contract row
types exactly, with no `Date` → string conversion at every read.

---

## 4. Job model

- One job = one **step** of one video. Step ids are stable and ordered:
  `create-scenes → create-vocal → create-images → create-captions → render`.
- Every step is **idempotent**, keyed by `(video_id, step)`:
  - if its artifacts already exist → return them, charge nothing;
  - if a `job_lock` is live → wait/requeue, never duplicate.
- Each step commits: artifacts + `credit_ledger` rows + `status/step` + next job **in one tx**.
- Failure writes `status=failed`, `step=<failed step>`, `error`, and **keeps** artifacts.
  Retry re-enqueues from that step.
- Concurrency: separate pools per step (`create-images` is slow and wide, `create-vocal` is
  serial per video). Global cap + per-workspace cap.

`packages/queue/src/step.ts` implements this as `withStep`, and it is the only code allowed to
write pipeline state:

- **Claim** runs in its own short transaction: `select … for update` on `video` (so the cursor
  check is not a race), then the `job_lock` row. Lock order is always video → lock → workspace,
  in claim and commit alike, so two workers cannot deadlock on one video.
- A lock is live for `DEFAULT_LOCK_TTL_MS` (30 min, above the slowest documented step). An
  expired lock is taken over with `attempt + 1`; a live one returns `locked` and the duplicate job
  is dropped.
- **Commit** opens a connection-level transaction, re-checks the cursor and that the lock still
  carries *our* `attempt`, then runs the body's transaction callback, deletes the lock and
  commits. This is what stops a worker that was paused past the TTL from overwriting the winner.
  `attempt` fences one lock's lifetime; it resets when the lock is released, so it is not a retry
  count.
- **Failure** releases the lock in every terminal case: a permanent failure records
  `status=failed` + `error` and swallows the error; a `StepFailure(..., { retryable: true })`
  rethrows so pg-boss retries, leaving video state untouched. Any other error is treated as
  permanent on purpose — a blind retry of a validation bug only burns provider quota, so adapters
  must classify transient failures themselves.
- **No network inside the commit.** The body does provider calls between claim and commit; the
  transaction stays milliseconds long.
- **`ping` is not a step.** It is a separate queue (`packages/queue/src/ping.ts`,
  `retryLimit: 0`) used to prove the worker can claim and complete a job against a real
  database. It is deliberately outside `VIDEO_STEPS`, so the public step vocabulary cannot grow
  for an operator's convenience. `ensureQueues()` creates it alongside the five step queues, and
  `checkQueues()` — which backs `/health.queue` — requires all six.

---

## 5. Storage layout

```
s3://bucket/
  ws/{workspaceId}/videos/{videoId}/frames/0001.png
  ws/{workspaceId}/videos/{videoId}/audio/narration.mp3
  ws/{workspaceId}/videos/{videoId}/audio/scene-003.mp3
  ws/{workspaceId}/videos/{videoId}/captions.ass
  ws/{workspaceId}/videos/{videoId}/render-1080p-30.mp4
  ws/{workspaceId}/styles/{styleId}/profile.json
  ws/{workspaceId}/styles/{styleId}/preview.png
  public/voices/{voiceId}.mp3
```

Disk adapter mirrors this under `.data/` for local dev. Public URLs are signed or served by a
static route; `videoUrl` for completed renders must be stable and unauthenticated (parity).

---

## 6. Security

- API keys: `vp_` + 40 hex; store `sha256(key)`; show once.
- Workspace scoping enforced in one place (`withWorkspace(ctx)`), never per-handler.
- Webhook delivery: HTTPS only, block private IPs (SSRF), 10 s timeout, capped payload.
- Uploads: MIME sniff + size cap + extension allow-list; never execute.
- OAuth for MCP: PKCE S256 only, no client secrets, 12 h access / 90 d refresh with rotation,
  revoke both halves atomically.
- Rate limits: per key and per workspace, on create and on TTS.
- Artifact paths are never user-controlled (`videoId` is a UUID; scene idx is an integer).

---

## 7. Configuration

Everything engine-related is env, everything product-related is a row.

```env
# core
DATABASE_URL=postgresql://faceless:faceless@127.0.0.1:5433/faceless
PORT=3001
PGBOSS_SCHEMA=pgboss
PUBLIC_BASE_URL=http://127.0.0.1:3001
MEDIA_SERVICE_URL=http://127.0.0.1:8000
STORAGE=disk                      # disk | s3
DATA_DIR=.data

# engines (first healthy wins, left-to-right)
PLANNER=cloudflare,groq,ollama,heuristic
IMAGE=cloudflare,pollinations,comfyui,procedural
STYLE=cloudflare,gemini,heuristic
TTS=edge,indicf5,piper
ASR=whisper-local,cloudflare

# optional credentials — the app runs with none of these
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
GROQ_API_KEY=
GEMINI_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434
COMFYUI_URL=http://127.0.0.1:8188

# limits / quality
MAX_SCRIPT_CHARS=50000
MAX_VIDEO_MINUTES=30
DEFAULT_RESOLUTION=1080
```

---

## 8. Failure philosophy

Every external call is assumed to fail eventually:

| Failure | Behaviour |
|---|---|
| Provider 429/5xx | retry with jitter, then next adapter in the chain |
| Provider returns garbage | validate against zod schema, treat as failure |
| TTS returns audio but no word boundaries | fall back to forced alignment (ASR) rather than dropping captions |
| Image generation produces corrupt bytes | retry once, then placeholder + flag scene for redraw |
| ffmpeg non-zero | keep the timeline JSON, expose the stderr tail in `error`, no charge for render |
| Worker dies mid-step | lock expiry → requeue → step re-runs idempotently |
