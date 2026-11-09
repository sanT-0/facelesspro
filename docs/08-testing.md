# 08 — Testing (code → test → next)

The rule is not "test at the end". It is: **nothing moves to `done` without a passing gate.**

---

## 1. The loop

```
  ┌───────────────────────────────────────────────────────────────┐
  │ 0. pick one task from docs/09-roadmap.md (one, not three)     │
  │ 1. write the contract: types (zod) + failing test(s)          │
  │ 2. implement the smallest real version that passes            │
  │ 3. run `npm run gate` (and `pytest` if media touched)         │
  │ 4. artifact check — does it actually produce the thing?       │
  │ 5. tick docs/PROGRESS.md, then and only then pick the next    │
  └───────────────────────────────────────────────────────────────┘
```

Step 4 is the part people skip. "Tests pass" is necessary, not sufficient. Every roadmap item
names its **artifact check** — the concrete thing you can look at, listen to, or play.

---

## 2. `npm run gate`

```json
"gate": "npm run typecheck && npm run lint && npm run test"
```

| Command | What it covers | Speed target |
|---|---|---|
| `typecheck` | `tsc --noEmit`, strict, `noUncheckedIndexedAccess`, all packages + apps | < 10 s |
| `lint` | eslint 10 + typescript-eslint: `core` purity (relative imports only, no `Date`/`process`/`fetch`/`Math.random`), package boundaries, barrel-only imports, `no-explicit-any` | ~2 s |
| `test` | every hermetic `*.test.ts` in `packages/*/src` and `apps/*/src` — unit, contract and wiring tests in one vitest run | < 5 s |
| `test:db` | `withStep` and app pipeline-step integration against live Postgres + pg-boss (`vitest.db.config.ts`) | < 30 s |
| `pytest` | `services/media` + `services/render` | < 60 s |
| `test:live` | opt-in `RUN_LIVE=1` (Python) / `LIVE=1` (TS), hits real providers | minutes |
| `sample:tts` | writes the 7 listening clips for one voice pair into `samples/tts/<pair>/` (`TTS_PAIR`; `TTS_OUT_DIR` only for scratch) | minutes |

**Default CI runs everything except `live`, `sample:tts` and `test:db`.** Those exist for the
human gate or need a service; a gate must pass with no database running, or a missing Postgres
looks like green tests.

`.github/workflows/ci.yml` is that sentence as a workflow: a `gate` job (node 22, `npm ci`,
`npm run gate`) and a `python` job (3.12, real ffmpeg via `apt-get`, `ruff check app tests`,
`python -m pytest`). Adding `test:db` to CI means adding a Postgres service container in the same
change — a job that skips when the service is absent would be a green light for a broken queue.

`test` is deliberately **not** split into `test:unit` / `test:contract`: the split only earns its
keep when one half needs different isolation (an in-memory pg, a testcontainer), and a script CI
forgets to run is worse than one suite that always runs. When that need appears it becomes a
vitest project inside `test`, not a second command beside it.

Boundaries are enforced by `eslint.config.js`, not by convention: `packages/core` may import only
relative files, `packages/contracts` only `zod`, packages may not import `apps/*`, and deep
`@facelesspro/*/src/*` imports are rejected in favour of the package barrel. `apps/api` and
`apps/worker` may not import `pg-boss` (or, for the api, `pg`/`drizzle-orm`): the vendor stays in
`@facelesspro/db` and `@facelesspro/queue`.

---

## 3. Test matrix by layer

### 3.1 `packages/core` (pure, no I/O)

| File | Asserts |
|---|---|
| `segmenter.test.ts` | Tamil/en/tanglish labelling, run merging, punctuation preservation, "no two adjacent runs share a lang", overrides |
| `transliterate.test.ts` | 300-pair golden table, residual passthrough, never throws on emoji/digits/combining marks |
| `numbers.test.ts` | ta vs en expansion of 2024 / ₹500 / 3pm / 50% / 1,20,000, and a comma after a number survives (the clause pause) |
| `scenes.test.ts` | 8–20 s scenes, no runt at the end, over-long sentence split at word boundaries, ≤120 scenes by merging, spans contiguous and ending on the narration estimate, `concat(text) === script`, determinism, bad bounds rejected |
| `captions.test.ts` | line breaking, word limit, Tamil grapheme clusters never split, cue monotonicity |
| `timeline.test.ts` | global = run.start + word.local; gaps by boundary class; no overlaps |
| `pricing.test.ts` | unit-cost math matches the table; `ceil` boundaries; zero-minute guard |
| `ass.test.ts` | ASS v4+ header/style/events, BGR colour packing, centisecond timecodes, karaoke `\k` durations, explicit `\N` line breaks, text escaping, template position/font/colour mapping; emoji only with `spec.emoji`, inline `\fn` family override, one-cluster validation, karaoke spans unchanged |
| `emoji.test.ts` | allow-list is unique single-cluster emoji and lowercase unique words; punctuation/case-insensitive lookups for English and Tamil; emphasis by `!`/`?`/`…` or ≥3-letter ALL-CAPS; opt-in no-op; cue-final and mid-cue emphasis selection; ≤1 per 2 cues and a larger configurable gap; never rewrites words/lines/timing; idempotent with preserved emoji; invalid gaps rejected |
| `caption-export.test.ts` | format vocabulary; SRT comma and VTT dot timecodes including >99 h; numbered multiline Tamil cues; emoji appended to a copied final SRT/VTT line only; `WEBVTT` header; strict JSON v1 with word timings and separate emoji; stable pretty JSON/trailing newline; MIME/extension dispatch; ASS delegates to karaoke writer and requires dimensions; empty, fractional, overlapping, line/word-drift and multi-cluster-emoji inputs rejected |
| `thumbnail.test.ts` | 25% timestamp including odd/very short durations; 1280 long-edge cap for landscape/portrait/4:3/extreme aspect; no upscaling; positive integer validation; one deterministic plan with source/output geometry and duration, input metadata not mutated |
| `render.test.ts` | render vocabulary pinned including `standard|greenscreen`; 1080/1440/2160 landscape/portrait geometry; cumulative frame allocation sums exactly without per-scene drift; one scale/crop/zoompan chain per standard still and every motion expression; green variant uses a frame-exact `#00FF00` source, omits still inputs, maps narration at input 0 and retains escaped ASS; all six fps/resolution combinations build exact frame totals; H.264 + explicit stereo AAC-LC/48 kHz/192k, CRF/CFR/faststart/metadata flags; deterministic args; malformed format and sub-frame timelines rejected |
| `samples.test.ts` | one sample directory per pair id, every set under `samples/tts`, and non-ids rejected (engine voice id, absolute path, `..`) |
| `sentences.test.ts` | Tamil/Latin terminators, abbreviations (`Dr.`, `Rs.500`, `p.m.`, `திரு.`), decimals, initials, ellipsis, closing quotes, Tamil quotatives (`"…?" என்று` stays one sentence), paragraph breaks, offsets into the normalised script, `concat === script` |
| `duration.test.ts` | ta 130 / en 150 / mixed 140 wpm, per-word blend, numbers expanded before counting, `₹1,20,000` = 5 words not 1 and unspellable digits keep the mixed rate, one 300 ms gap per sentence, `durationMs`, zero for silence, override rates, rate validation |
| `estimate.test.ts` | `estimateScenePlan` → `scriptLanguagePlan` routing (ta/en/mixed/override), scene split reassembles `normalizeScript(script)`, `totalMs === last endMs === estimateDuration`, non-overlapping positive spans, `EmptyScriptError` for blank/punctuation-only/wordless input, options passthrough (slower voice → more scenes), determinism |

Property tests (fast-check) for the timing invariants: 10k random voice plans must produce a
monotonic, gap-respecting, non-overlapping timeline.

### 3.2 `packages/art` (real ffmpeg/libass)

| File | Asserts |
|---|---|
| `ass-render.test.ts` | bundled font SHA-256 pins (Tamil, Sans, Emoji); committed 1280×720 human-review golden PNG; real ffmpeg selects `NotoSansTamil-Variable.ttf` and `NotoEmoji-Variable.ttf`; exact 640×360 RGB output; >1,000 non-background glyph pixels; two different emoji at the same layout rasterise to different frames (catches identical `.notdef` tofu). Pixel digest is advisory, never a hard failure. |
| `render.test.ts` | real ffmpeg standard gate composes two stills with motion + WAV + Tamil ASS into H.264/stereo AAC; ffprobe requires two audio channels, 1920×1080, 30/1, exactly 45 frames and duration within 100 ms; sampled pixels prove the cut and >500 caption pixels; repeat output byte-identical. Variant gate requires captioned portrait 4K/60 greenscreen, exactly six frames, stereo AAC, duration tolerance, a clean green centre and >1,000 overlay pixels while its deliberately missing still is never read. Standard missing inputs surface ffmpeg stderr rather than an empty artifact |
| `caption-export-render.test.ts` | generated Tamil SRT and WebVTT are both accepted by real ffmpeg/libass; bundled `NotoSansTamil-Variable.ttf` selected; exact RGB frame size and >500 non-background pixels for each format |
| `thumbnail.test.ts` | real ffmpeg source changes red→blue before its 25% point; extractor ffprobes 1920×1080/4 s, selects 1000 ms, creates nested parent and verified 1280×720 RGB PNG whose centre is blue; retry is byte-identical with no `.part`; missing source names ffprobe and leaves no partial/output |

### 3.3 `packages/contracts` (zod only, no I/O)

| File | Asserts |
|---|---|
| `requests.test.ts` | every documented default (V3 stability 50, V2 stability 38 + style 50, roblox pitch 140, TTS 38); script limit per aspect; exactly one of script/voiceover; https-only webhook with localhost rejected; unknown keys rejected; all 16 V2 and 9 quiz image styles; unknown `characterId`; `correctIndex` bounds; `{{answer}}` required; 100-item and 1000-message caps; caption-template id 0 invalid |
| `transport.test.ts` | the error-code table (11 codes → documented statuses); create vs read video shape; webhook body embeds the same video schema; 10 attempts = 9 gaps totalling ~24 h; signature covers `t.body`; synthesize request parity with pydantic; the Python timeline parses including `+00:00`/microseconds; cache-stats union; the transcribe response (segments with ≥1 global word, positive spans, language/duration/text required) and its rejections (empty segments/text, zero-length span, negative start) |
| `db.test.ts` | one realistic row for each of the 18 tables (the `job_event` row carries every metric column); unknown `job_event` outcomes and negative durations/items rejected; `retryable` is a member of the outcome tuple; `credits` required and nullable; caption-template id 0 rejected on templates and tracks; a caption track retains authored lines, timed words and optional one-cluster emoji; the upstream `create image` spelling rejected; narration requires a voice plan |
| `planner.test.ts` | adapter and motion vocabularies pinned; a heuristic-shaped plan parses; `degradedFrom` keeps the order tried; unknown motion, empty text/prompt, over-long prompt rejected; zero-length scene, overlap, a first scene not at 0, `totalMs ≠ last endMs`, empty plan, >120 scenes, unknown keys all rejected |
| `image.test.ts` | image adapter vocabulary pinned; capabilities require unique non-empty sizes, profile styling and caller seed; request requires final prompt, negative, seed, size and valid `StyleProfile`; generated result requires non-empty PNG bytes, provenance, ≤4096 geometry and orientation matching `landscape|portrait`; unknown keys rejected |
| `art-style.test.ts` | request side: formats default to `["landscape"]`, `published` defaults false, empty/unknown formats and unknown keys rejected, only `status: "building"` accepted on create. Response side: a list entry requires `previewUrl`, non-empty `formats` and echoes `status`; a full `StyleProfile` round-trips through the export document and a profile missing `source` or a `version ≠ 1` is rejected |
| `responses.test.ts` | caption-template responses accept negative built-in and positive custom IDs but reject reserved ID `0`; strict caption JSON v1 accepts raw timed lines/words + one-cluster emoji, rejects unknown/path fields, newline/multi-emoji content, non-sequential indexes, cue overlap and a duration that differs from the last cue end |

Because these schemas are the single shape source, a red contract test blocks api, worker, web
and mcp at once — that is the point.

### 3.4 `apps/api`

| Test | Asserts |
|---|---|
| `health` | `200` when both probes resolve, `503` when either throws or hangs; a hung probe is cut at the deadline, not waited on; `status` is derived from the components; the body parses through `healthSchema` and never contains the probe's error text |
| `auth` | missing / malformed / unknown / revoked key → `401 unauthorized` with `WWW-Authenticate: Bearer`; the same body for every case; a rejected request never reaches a mutating dependency |
| `api-keys` | `POST /v1/keys`: `201` parses through `createApiKeyResponseSchema`, trims `name`, calls create with the authenticated `workspaceId`, returns the secret once and never the hash or `workspace_id`; blank/missing/wrong-type/unknown name field → `400` + `field`; malformed JSON → `400 request body must be JSON`. `GET` lists active and revoked rows in camelCase with no hash. `DELETE`: `200 {apiKey}` with `revokedAt`, repeat revoke returns the same timestamp, non-UUID → `400` + `field: "id"`, unknown/other-workspace id → `404`; the revoke dependency is not called on a rejected id |
| `rate-limit` | 60/300 defaults and positive-integer env overrides; fixed one-minute windows per key and workspace; the workspace window is shared by different keys while one key's limit does not affect another; rejected requests do not extend the lockout; `Retry-After` is whole seconds remaining (at least 1); invalid config throws; middleware returns `429` only after auth (`401` wins and never consults the limiter) |
| `create.ai-videos-v3` | required fields, both script+voiceover → 400, neither → 400, bad size for style → 400 |
| `create.defaults` | every documented default is applied exactly |
| `status` | status/step transitions; `render` while processing → 409 |
| `plan` | `POST /v1/videos/plan`: 200 estimate parses through `planVideoResponseSchema`, `adapter: "heuristic"`, scene texts rejoin to `normalizeScript(script)`, `totalMs` equals the last `endMs`; blank / punctuation-only / portrait-over-ceiling / unknown key / missing script → `400 invalid_request` with `field: "script"`; invalid JSON → `400 invalid_request`; a throwing DB probe still returns 200 (no database touch) |
| `art-styles` | `POST /v1/art-styles`: `202` with `createArtStyleResponseSchema` (`id`, `status: "building"`, `createdAt`); submission contains one contract-shaped row plus `{styleId, referenceKey}` for an atomic insert+enqueue; the key is `references/<server uuid>.mp4|mov` and ignores the untrusted client filename; bytes land under the injected shared storage root; missing file / non-video / invalid formats / empty name → `400 invalid_request` with `field: "file"` or `"formats"`; no submission on validation failure; ffprobe mocked in tests. `GET /v1/art-styles`: only `status='ready'` rows, `building`/`failed` filtered even if the repository returns them; body parses through `artStyleListSchema`; `art-styles/<id>/preview.png` → `/files/art-styles/<id>/preview.png`, absolute URLs untouched, `sampleVideoUrls` keys mapped the same way, absent `portraitPreviewUrl` omitted; empty catalog → `{styles: []}`. `GET /v1/art-styles/:id/export`: body is exactly `{version: 1, name, formats, profile}` with no `id`/`status`/`previewUrl`; a full `StyleProfile` round-trips; `building` → `409 conflict`, unknown id → `404 not_found`, malformed id → `400 invalid_request` + `field: "id"`, corrupt stored profile → `500 internal` |
| `caption-templates` | `GET /v1/caption-templates`: list parses through `captionTemplateListSchema`; database-only `workspace_id` omitted; empty list valid; private five-minute cache + 64-hex content ETag; matching `If-None-Match` → bodyless `304`; invalid stored ID `0` → fixed `500 internal` envelope |
| `videos` | `GET /v1/videos/:id`: a completed row serialises through `videoResponseSchema` with `error: null`, `durationMs`, and the stored render key rewritten to an absolute `<base>/files/…` URL; a failed row keeps `step` (the resume point) and its `{code, message}`; `render` reflects whether the stored create request asked for an mp4; an absolute stored URL and a trailing base slash pass through; `scenes`/`thumbnailUrl` are absent; unknown id → `404`, non-UUID → `400` + `field: "id"`, completed without a render key or a malformed stored error → fixed `500 internal` |
| `video-render` | `POST /v1/videos/:id/render`: a 60 fps greenscreen body reaches `queueRender` as `{videoId, render}` and returns `202` + `videoResponseSchema` (`status: "rendering"`, `step: "render"`, previous `videoUrl` still present); no body means the 1080/30/standard defaults; `webhookUrl` is passed separately and replaces the stored callback; `processing`/`rendering`/`failed` → `409 conflict` with that status; unknown id → `404`; non-UUID → `400` + `field: "id"`; malformed JSON → `400 request body must be JSON`; bad `resolution`/`frameRate`/`format`/webhook URL/unknown key → `400` naming the field; the queue dependency is never called on a rejected request |
| `videos.db.test.ts` (`test:db`) | real Postgres: `findVideo` serves an inserted completed row through the same route, with zod-parsed timestamps normalised to UTC `Z` and an unknown UUID → `404` |
| `api-keys.db.test.ts` (`test:db`) | real Postgres: `POST /v1/keys` stores exactly `sha256(token)` (not the token), keeps the visible prefix, and returns the secret once; the new key authenticates, sets `last_used_at`, and a second auth inside the throttle window keeps the same timestamp; list contains only the caller's workspace, active and revoked, with no hash; `DELETE` makes the token `401` immediately, a repeat revoke keeps the first `revokedAt`, and another workspace's key is `404` and stays active |
| `video-render.db.test.ts` (`test:db`) | real Postgres + pg-boss: `202` moves `completed` → `rendering`/`render`, rewrites only `request.body.render` (script and art style survive), persists the render-call webhook, and leaves exactly one `render` job carrying `{videoId}`; a second call while rendering is `409` and changes neither profile nor queue; a `failed` video is `409` with `step` still `create-images` and nothing queued; unknown UUID → `404` and nothing queued |
| `video-retry` | `POST /v1/videos/:id/retry`: a failed generation step returns `202` + `videoResponseSchema` (`processing`, `step` unchanged, `error: null`); a failed `render` returns `rendering` and keeps the previous public `videoUrl`; `processing`/`rendering`/`completed` → `409 conflict` naming the status; unknown id → `404`; non-UUID → `400` + `field: "id"`; a malformed returned row → fixed `500 internal` |
| `video-retry.db.test.ts` (`test:db`) | real Postgres + pg-boss: a failed video at `create-images` is re-queued exactly once on that queue with `{videoId}`, its `error` is cleared, the stored request is untouched and no ledger row is written by the retry; a failed `render` goes back to `rendering` with the old mp4 still served; a second retry while `processing` is `409` with one job still queued; `completed` is `409`; unknown UUID → `404` |
| `webhooks` | http:// rejected, localhost rejected, signing header present |
| `errors` | codes table from [07](./07-api-and-mcp.md#12-errors-p) is exhaustive |
| `app` | an unexpected throw from any dependency returns `500 application/json` with `error.code: "internal"`, a fixed message and no path/stack leak; the real error is logged |
| `mcp.tools` | tool list matches the endpoint list 1:1 (a test, not a convention) |

### 3.5 `packages/db` (hermetic; no database connection)

| Test | Asserts |
|---|---|
| `schema.test.ts` | the 18 tables are exactly `DB_TABLES`; every column name matches its contract row schema; the three public enums are built from the contract tuples; `workspace.credits` is nullable; `caption_tpl.id` is an integer primary key; built-ins are exactly IDs -1…-6 with six unique names and valid row specs; the dev workspace is `selfhost` with `credits = null`; compile-time `$inferSelect` ⊇ contract row for five tables |
| `timestamp.test.ts` | Postgres text (`2026-10-26 18:12:34.567+00`) → ISO UTC; real offsets (+05:30, −04:00, +05:45) converted, not stripped; already-ISO input stable; missing fraction filled; output passes `isoDateTimeSchema`; microseconds truncated (documented); unparseable passthrough; `infinity` preserved; `created_at.mapFromDriverValue` normalises the exact string drizzle hands back |
| `client.test.ts` | the default connection string agrees with `.env.example`; an empty `DATABASE_URL` falls back; `loadEnv` is silent with no `.env` |
| `create-api-key.test.ts` | `key:create` defaults to `DEV_WORKSPACE_ID`, trims the label, accepts `--name=value` and `--workspace=<uuid>`, rejects missing/blank/over-long names and non-UUID workspaces, and does not read a following flag as a value |

The migration itself is verified by running it (docs/09 P0), not by a unit test: from a clean
database, `npm run db:migrate` must report the caption-template seed and land on the same table
count every run (currently 18 tables, two applied migrations: the P0 baseline plus
`0001_omniscient_falcon` for `job_event`).

### 3.6 `packages/queue` (hermetic) + `test:db` (Postgres)

`jobs.test.ts`, `ping.test.ts`, `art-style.test.ts` and `health.test.ts` run in
`npm run gate`, no database:

| Test | Asserts |
|---|---|
| `jobs.test.ts` | queue name == step id for every contract step; `parseJob` rejects a non-object payload, a missing/malformed `videoId`, and an unknown queue (before looking at the payload); `jobData` drops everything but `videoId`; `nextStepOf` follows the public order and returns `null` after `render`; queue policy is 2 retries with backoff, 1 h expiry, 1 day retention; the default lock TTL is 30 min |
| `ping.test.ts` | `ping` payload is a strict object with an optional trimmed note (blank/oversized/non-string rejected); the queue never retries and keeps the row for a day; `consume` subscribes once with `batchSize: 1`, parses every job, and fails the whole batch on the first malformed payload instead of skipping it |
| `art-style.test.ts` | payload is exactly `{styleId, referenceKey}`; traversal, absolute/backslash/doubled paths and a non-UUID id rejected; queue is distinct from video steps; one retry / 15 min expiry; `singletonKey=styleId`; transaction handle and delayed start pass through |
| `health.test.ts` | `expectedQueueNames()` is the five steps in contract order plus `build-art-style` and `ping`; `checkQueues` resolves only when every queue row exists, names all missing ones, passes names as a query parameter (never interpolated), honours a custom schema, rejects a schema that is not a plain identifier, and propagates a database error |

`step.db.test.ts` runs only under `npm run test:db` (`vitest.db.config.ts`, `DB_TESTS=1`),
against `docker compose` Postgres:

| Test | Asserts |
|---|---|
| commit | artifact + ledger row + `status`/`step` cursor + next job all land; `videoRowSchema` parses the row; credits 100 → 97; one `job_event` row with `outcome='committed'` carrying the `ctx.observe(...)` metrics (`adapter`, `items`, `ok`, `bytes`, `cost_units`, `degraded_from`) and `duration_ms ≥ 0` |
| stale | a job for a step the video already left is dropped, body never called; one `job_event` row `outcome='stale'`, `attempt=null` |
| locked | a live lock returns `locked` with `retryAfterMs`, body never called, the lock is untouched; one `job_event` row `outcome='locked'` |
| expired | a 31-minute-old lock is reclaimed with `attempt + 1` |
| failure | `status=failed`, `error={code,message}`, step kept, credits and ledger unchanged, lock released; one `job_event` row `outcome='failed'` carrying the error and any observed metrics |
| retryable | rethrows the same `StepFailure`, video still `processing`, lock released so the next claim is immediate; one `job_event` row `outcome='retryable'` with the error; the successful retry commits with its own row |
| atomicity | a throw after artifact write + charge + enqueue rolls back all three: no `video_url`, no ledger row, no queued job |
| credits | `insufficient_credits` fails the step without debiting; an unlimited workspace (null credits) records usage without inventing a balance |
| reused | `{ reused: true }` advances the cursor with no charge and no ledger row; one `job_event` row `outcome='reused'` |
| superseded | an attempt whose lock was taken over returns `superseded`, charges nothing, and leaves the winner's lock intact; one `job_event` row `outcome='superseded'` |
| missing | a deleted video is dropped, not retried, and writes no `job_event` (there is no video row to attach it to) |
| no commit | a body that neither commits nor reports `reused` fails with `internal` |
| concurrency | two jobs for one `(video, step)` run the body once: the second sees `locked` while the first holds it |

### 3.7 `apps/worker`

| Test | Asserts |
|---|---|
| `ping` | `startWorker` consumes exactly the `ping` queue when no optional handlers are supplied; a job is logged and resolves (so pg-boss marks it completed); a malformed payload throws `InvalidJobError` rather than being swallowed; `stop()` calls `offWork` for every queue it started and nothing else |
| `art-style worker wiring` | supplying the real-build handler registers `build-art-style` after `ping`, parses the contract payload before handing it over, rejects malformed jobs without calling the handler, and drains both queues on stop; omitting the handler keeps isolated wiring tests on `ping` only |
| `video-step worker wiring` | only supplied stable step ids are consumed; payloads pass through `parseJob` before the handler; malformed ids fail without calling work; queues for later P5 steps remain untouched; shutdown drains every registered queue |
| `steps/create-scenes.test.ts` | stored V3 request and style re-validation; deterministic `StyleProfile` → planner clauses; published/private/ready/orientation rules; plan reconstruction and contract validation before commit; all-transient planner failure stays retryable; persistence and `advance()` happen once after planning; **voiceover branch:** download → ASR at the downloaded mime, no planner/TTS call, ASR segments become scenes (first at 0, contiguous, last on the audio duration, Tamil/English text preserved, `adapter: heuristic`), the upload is stored and one transaction persists the plan + transcription + stored audio then advances; download codes mapped (`invalid_request`/`payload_too_large` permanent, `upstream_failed` keeps its retryability); ASR 422/413 permanent, 502 permanent, 503 retryable; unordered segments and overlapping words rejected permanently without a store or commit; 130 sentences merge to the scene cap with every cut still on a boundary and the text intact; a disk failure stays retryable with no commit |
| `steps/create-scenes.db.test.ts` (`test:db`) | real Postgres + pg-boss commit stores the plan, duration and ordered scene rows and enqueues `create-vocal`; a duplicate delivery is stale, calls the planner once, inserts no duplicate scenes/jobs and writes no zero-unit ledger row |
| `tts/media.test.ts` | pair ids resolved through `GET /voices/:pairId` with trailing-slash-safe base URL; 404/422 permanent and 429/5xx/network retryable; a malformed pair or synthesize body permanent; the encoded master is read into memory and timings are rebased to camelCase; an unreadable/empty master is permanent; a request that fails the contract never reaches HTTP |
| `asr/media.test.ts` | raw bytes posted to `POST /transcribe` with the caller's mime (no multipart/JSON wrapper), global word timings rebased to camelCase, request id/language/duration/text preserved; empty audio and a non-audio mime refused before any request; 404/413/422/502 permanent while 503/5xx/429/network retryable (a 502 means no usable speech, not infrastructure); unreadable JSON and a schema-invalid transcript permanent; failures are `AsrPortError` |
| `voiceover/download.test.ts` | extension read from the pathname (case/query-insensitive); every `AUDIO_EXTENSIONS` entry maps to an `audio/*` mime and nothing else; bytes within the cap returned with mime and final URL; non-https/non-audio/unparseable URLs refused before any request; https redirects to another audio file followed with the final URL reported; a redirect that leaves https or loses the extension is permanent; bounded redirects (max + 1 requests); an over-cap `content-length` rejected without ever asking for a body reader; a body crossing the cap mid-stream aborted; a stream without `content-length` accepted up to the cap; empty body permanent; HTTP 429/5xx and network failures retryable, 404 permanent; failures are `VoiceoverDownloadError` |
| `steps/create-vocal.test.ts` | scenes validated against the stored script, planned per scene and synthesised in one request; `voiceId` becomes the pair id and an absent one uses `TTS_PAIR`; a voiceover request advances without resolving a pair, synthesising, storing or charging (the upload's narration was written by `create-scenes`); 404/422 map to `invalid_request`, 429/5xx/unknown errors stay retryable `upstream_failed`; a response with a different count/text/voice, non-monotonic words or an empty scene span is a permanent upstream failure with no store or commit; a disk-write failure stays retryable with no commit; storage happens before the single commit that charges characters and advances once |
| `steps/create-vocal.db.test.ts` (`test:db`) | real Postgres + pg-boss + real ffmpeg/ffprobe MP3: one asset row, narration row, contiguous scene spans ending on the probed duration, video duration, ledger row and `create-images` job; the stored bytes hash identically to the encoded file; a duplicate delivery writes nothing twice and leaves one queued job |
| `steps/create-scenes.db.test.ts` (`test:db`) | real Postgres: the voiceover commit writes the plan/duration, ordered scenes (first at 0, contiguous, last on the audio duration), one audio asset with the upload's key/bytes/mime and one narration row whose ASR word timings and empty-`runs`/null-`pair` voice plan parse against the shared contracts |
| `steps/create-images.test.ts` | stored plan and scenes re-validated one-for-one; style visibility/status/orientation re-checked before drawing; each request carries the stored composed prompt, the required negative terms, `sceneSeedFor(videoId, idx)` and the full profile; the guard receives only previously accepted histograms; manifest records the accepted prompt, seed, provenance and SHA-256; storage happens before the single commit that charges `ceil(scenes/20)` and advances once; plan/row mismatches are internal; `ImageChainError` keeps its retryable verdict; unknown draw errors stay retryable; a disk-write failure stays retryable with no commit |
| `steps/create-images.db.test.ts` (`test:db`) | real Postgres + pg-boss + the offline procedural adapter and real ffmpeg: two 1024×576 RGB PNGs stored under the documented keys, one `image` asset per scene linked from `scene.image_asset_id`, a schema-valid `frames/manifest.json` whose hashes/bytes match disk, one `action=image` ledger row, and the `create-captions` job; a duplicate delivery writes nothing twice and leaves one queued job |
| `steps/create-captions.test.ts` | `captions:false` advances without template/narration I/O, artifact, track or charge; enabled captions enforce built-in/workspace template visibility, use built-in `-1` when omitted, validate global narration words, preserve Tamil clusters, decorate emoji once, serialize ASS/SRT/VTT/JSON from one cue list and use a stable 1080p landscape/portrait ASS canvas; storage precedes the one transaction that persists, charges one subtitles unit and moves the cursor; `render:{}` advances to render, omitted `render` completes the editable project without enqueueing; missing/corrupt inputs write nothing, an over-wide word is permanent `unprocessable`, and disk failures remain retryable |
| `steps/create-captions.db.test.ts` (`test:db`) | real Postgres + pg-boss + real ffmpeg/libass: four byte-checked `caption` assets under deterministic keys, a lossless caption track equal to JSON cues minus export indexes, one 20-credit subtitles ledger row, `status=rendering` and one render job; retained ASS selects bundled Tamil font and renders a 1920×1080 PNG; duplicate delivery writes nothing twice |
| `steps/render.test.ts` | stored V3 request, narration, asset kinds/ownership and the exact scene tiling re-validated before ffmpeg; the plan receives scene order, resolved image paths, span durations, presets, narration path, profile and the bundled-font captions only when a caption track exists; 2160p portrait greenscreen at 60 fps bills the doubled unit cost; encoder output whose geometry/fps/duration disagrees with the request, a missing/empty thumbnail, and an unset duration are internal with no commit; ffmpeg and thumbnail failures stay retryable; persistence, charge and `advance` share the one commit; `renderUnitCost` is honoured |
| `steps/render.db.test.ts` (`test:db`) | real Postgres + pg-boss + real ffmpeg/libass/probe: one 1920×1080 H.264 yuv420p 30/1 MP4 with stereo AAC-LC 48 kHz and 2.000 s, one 1280×720 RGB thumbnail from the Tamil-captioned frame, `render`/`thumbnail` assets under the profile keys, a completed `render` row, `video.video_url`/`duration_ms`, one `action=render` ledger row (`units=0.03`, `unit_cost=10`, `delta=-0.3`) and `status=completed`/`step=null`; a duplicate delivery adds no row, asset or charge. **Re-render:** a completed video is moved to `rendering`/`render` by `beginRender` while the old mp4 stays the served `video_url`; the real handler then appends a second 1920×1080 H.264 **60/1** MP4 and thumbnail under the `-60-standard` keys, leaves the 30 fps file byte-identical, records two `render` rows (30 and 60), charges a second `action=render` row at `unit_cost=20` (`delta=-0.6`) without touching the first, and writes two `committed` `job_event` rows |
| `render-vocabulary.test.ts` | core's dependency-free restatement exactly matches contracts for scene motions, standard/greenscreen formats, landscape/portrait sizes, 1080/1440/2160 resolutions and the 120-scene cap; only contract frame rates 30/60 parse |
| `caption-export-vocabulary.test.ts` | core's dependency-free `srt|vtt|ass|json` tuple exactly matches the shared format schema; its generated JSON document parses through the strict shared response schema |
| `steps/pipeline-resume.db.test.ts` (`test:db`) | real Postgres + pg-boss through `create-scenes` → `create-vocal` → `create-images` → `create-captions` (offline heuristic planner, fake TTS with a real ffmpeg MP3, procedural images): a redelivered committed step is `stale` and changes no asset, ledger row or queued job; `job_event` shows three `committed` outcomes and one `stale`; the following `create-captions` still completes from the committed artifacts (four caption assets, one track, one render job); exactly one `tts`/`image`/`subtitles` ledger row each, so the workspace is debited once and the summary artifact records the spend; a doubly delivered first step inserts one set of scenes and one next job. **Real process kill:** a spawned worker process is `SIGKILL`ed inside `create-vocal` after it claims the step (pg-boss job `active`, `job_lock` attempt 1, no narration/asset/ledger row); after pg-boss's own timeout, with the two recovery clocks fast-forwarded past the 1 h job expiry and 30 min lock TTL, a second worker process fetches the retry, takes the lock over at attempt 2 and finishes all five steps — one row per ledger action, one audio/frame set, four caption assets, one render + thumbnail, five `committed` events and one debit, not two; the summary artifact records the killed pid, job id, retry bookkeeping and MP4 hash |
| `planner.heuristic` | the fixture plans into a valid 8–20 s plan; `concat(text) === script`; style prefix/suffix/negative land in every prompt; prompts ≤1000 chars and trimmed by whole word (never inside a Tamil cluster); punctuation and emoji stripped from descriptions; motion cycles; no emphasis invented without a model; a slower voice gets more scenes; the cap is honoured past 20 s; empty script rejected; deterministic; `buildFixedPlan()` keeps caller-decided boundaries verbatim, describes each span, cycles motion from the first scene and records `adapter: heuristic` with empty `degradedFrom` |
| `planner.chain` | first healthy adapter wins with empty `degradedFrom`; each failure falls through and is recorded in order; all-fail throws `PlannerChainError` with every adapter's message and each failure's `retryable`; `PlannerChainError.retryable` is true only when every failure was transient (mixed and all-permanent are false); a non-`Error` rejection survives as text; an empty chain is rejected at construction |
| `planner.model` | `buildPlannerPrompt()` embeds the script verbatim between markers, states the word budget from the 8–20 s bounds and the expected scene count, names the style clauses as added-for-you, asks for JSON only and never for timings, and is deterministic; `parseModelText()` reads fences, surrounding prose and strips unknown keys but rejects empty/no-JSON/malformed bodies, an unknown motion, empty text, an over-long description and an empty scene list, with typed `PlannerResponseError`; `planFromBeats()` keeps the model's cuts, reassembles the script exactly, derives contiguous timings, places a 300 ms gap only where a sentence ends, injects style into every prompt, filters emphasis to words present in the scene (once, capped), reports all violations at once (`text-mismatch`, `scene-empty`, `scene-too-short`, `scene-too-long`, `prompt-too-long`, `contract`) and marks them not retryable |
| `planner.http` | POSTs JSON with caller headers and returns the body; network failure and timeout are retryable and name the limit; `408`/`425`/`429`/`5xx` retryable; `400`/`401`/`403`/`404`/`422` permanent; a `200` with a non-JSON body is permanent; a provider body is truncated into the message |
| `planner.repair` | a valid first answer costs one call; a rejected answer is re-asked **once** with the violation, the script and the rules, and the repaired plan is returned unchanged; an unreadable or wrong-shape answer is re-asked for one JSON object; a second rejection surfaces the **second** violations and stops at two calls even when a third answer would be valid; a transport failure and a non-answer error are not re-asked (one call, same error, `retryable` preserved); a style that cannot fit the prompt budget is not re-asked either (a configuration bug, not wording); the repair prompt is deterministic |
| `planner.providers` | cloudflare uses the account-scoped model URL, `result.response`, bearer token; groq uses `/chat/completions` with `response_format: json_object` and honours a base-URL override without a trailing slash; ollama uses `/api/chat` with `format: json`, `stream: false` and a 120 s default; each adapter names itself in `plan.adapter`; an empty answer is a permanent `UpstreamError`, a `429` is retryable, a bad model answer is a `PlannerResponseError` (not an upstream failure); `*OptionsFromEnv` name every missing variable and read the model/timeout overrides; each adapter re-asks once with the violation and returns the repaired plan |
| `planner.factory` | `PLANNER` unset → heuristic alone with a warning; an unknown name is warned and ignored; a provider with missing credentials is skipped with the missing variables named; the configured order is preserved and the first healthy adapter plans; an upstream `500` degrades to the next adapter with `degradedFrom: ['groq']`; an all-unavailable list falls back to the heuristic; an injected env is used and the real `process.env` is not read |
| `frame-sampling.test.ts` | `scdet=threshold=30` scene detection parsed from `-v info` stderr, 3 evenly spaced frames, dedup within 1 s, cap 24 (prefers highest-scoring scenes), padding to 8 spaced frames when a reference has few cuts, rejection only when a video cannot hold 8 distinct frames; injected shared frames root; ffmpeg/ffprobe mocked through `spawn`; exit-code and ffprobe failures; `readdir` cleanup |
| `frame-decode.test.ts` | `fitWithin` caps the long edge, preserves aspect and never upscales; `probeFrameSize` parses `w,h`; `decodeFrame` skips ffprobe when the size is supplied, probes otherwise, and rejects a truncated stream or a failed ffmpeg |
| `style/palette.test.ts` | `#rrggbb` round-trip with clamping; two-tone image recovers both hexes and their pixel shares; flat frame → one colour, weight 1; near-identical clusters merge; identical input → identical output (no RNG); k clamps to distinct colours and to the 8-colour contract ceiling; stride sampling; non-empty RGB24 enforced |
| `style/color.test.ts` | sRGB→LAB matches the D65 reference values and round-trips within one byte; out-of-gamut LAB clamps instead of NaN; `deltaE76` is zero/symmetric; weighted palette centroid normalises unnormalised weights and rejects malformed input; bounded correction applies at most the cap, never mutates the input, is a no-op at the target or cap 0, reduces the nearest-palette distance, and never reports a `deltaE` above `maxDeltaE` across a 512-target grid (including the float boundary where `magnitude * (cap / magnitude)` rounds to `cap + 1 ULP`); soft 4×4×4 histogram sums to 1 and spreads 128 over eight 1/8 corners; 127 vs 128 stays under 0.05 instead of 1; total-variation distance is 0 for identical and 1 for disjoint extremes; invalid RGB lengths and bins rejected |
| `style/stats.test.ts` | flat frame → `edgeEnergy` 0 and `strokeDensity` 0; high-contrast stripes → both high; a flat black block does not inflate `strokeDensity` (ink needs an edge); grey saturation 0, red 1; brightness 0/1; contrast 0 on flat, high on stripes; `safeAreaStats` clean border vs full bleed; `percentile` interpolation; margin and buffer-size validation |
| `numeric-analysis.test.ts` | one palette across all frames (two solid frames → 50/50), flat reference → zero ink and saturation, ink metrics averaged across frames, aspect/orientation from the native size, deterministic, margin echoed, empty list rejected |
| `numeric-style-profile.test.ts` | numeric profile accepts landscape/portrait/single-colour; rejects weights that do not sum to 1, hex/weight count mismatch, empty palette, a hex without `#`, metrics outside 0..1, a ratio that disagrees with width/height, a wrong orientation, `frameCount` 0, and unknown keys |
| `style-vision.test.ts` | answer accepts a full answer, an empty cast and honest `unknown` enums; strips a volunteered palette and `line.color`; rejects unknown shading/line weight, non-kebab character ids, duplicate ids, more than 8 characters, typography present without a style or absent with one, empty medium/negative; provenance requires `adapter` from the enum and keeps `degradedFrom` order |
| `style-profile.test.ts` | merged profile accepts both halves; rejects unknown top-level keys, `version` 2, seeds outside 1..2 147 483 647, an ink colour outside `palette.hex` (case-insensitive match accepted), duplicate character ids, typography drift, a `measured` block missing a field or carrying an unknown key or a second palette, an unknown source adapter, and weights that do not sum to 1 |
| `style/profile.test.ts` | `lineColorFor` picks the darkest palette entry regardless of order, keeps the first on a luma tie, lowercases, rejects an empty palette and a malformed hex; `seedBaseFor` is deterministic and in range, changes with prompt text/characters/typography/palette hexes, ignores palette weights/order, and ignores measurements |
| `merge.test.ts` | measured palette copied unchanged, ink colour is the darkest entry and always in the palette, `measured` excludes `palette`, `unknown` medium preserved, character bible/typography copied, `source` keeps adapter + degradation order as a copy, output is schema-valid, seed stable when only tone changes, contract-breaking vision rejected |
| `preview.test.ts` | eight evenly spread frames selected from the sampler's 8–24 (first/last retained); grid uses eight frames + one weighted palette card; portrait centre crop; clip concatenates all nine cells rather than ending with the first, requests exactly 180 silent frames; ffprobe verification rejects a missing/wrong PNG stream, audio, wrong resolution/fps/frame count/duration and invalid probe output |
| `build.test.ts` | exact `sample → numeric → vision → merge → previews → verify → ready` order; profile and preview keys written only after verification; portrait key forwarded; missing/short previews mark failed **and reject** so pg-boss retries; ready row is reused; failed row can retry; missing row surfaces |
| `storage.test.ts` | `DATA_DIR` / `.data` default, safe relative keys, traversal/backslash rejection, deterministic preview keys, public URL construction, parent creation and file-size probe |
| `image/procedural.test.ts` | offline capability declaration; schema-valid RGB8 PNG at exact 1024×576 / 576×1024 dimensions; byte determinism for identical input; seed or prompt changes bytes; inflated scanlines use filter-none and contain only measured palette colours including ink; malformed request rejected at adapter boundary |
| `image/normalize.test.ts` | provider bytes go through stdin/stdout; centre-crop to exact target geometry; RGB24 forced before PNG encode; empty input and invalid geometry rejected before spawn; ffmpeg failure, empty output and non-PNG output surfaced |
| `image/cloudflare.test.ts` | env names all missing credentials and validates model/step/timeout overrides; account-scoped Flux URL, bearer token and exact prompt/seed/steps body; JPEG/base64 response normalized to exact landscape/portrait RGB PNG contract; malformed/missing image is permanent, HTTP 429 retryable, corrupt normalized output permanent; no network in tests |
| `image/pollinations.test.ts` | required key plus endpoint/model/timeout env; HTTPS URL and encoded Unicode prompt; known watermarked legacy host rejected; canonical model, exact dimensions/seed, bearer header never query; streamed 25 MiB cap with timeout covering the body; JPEG/PNG/WebP MIME must match magic; landscape/portrait normalize to PNG; 429/network/timeout retryable, auth/bad body/normalization permanent; no network in tests |
| `image/comfyui.test.ts` | env names workflow/output requirements and validates URL/timing; API-format graph gets typed prompt/negative/seed/width/height substitutions without template mutation; malformed graph/missing token/output rejected; `/prompt → /history/{id} → /view` including pending poll and exact output query; one configured image only; landscape/portrait propagation; full-response and poll timeouts retryable without sleeping; workflow/execution/output errors permanent; 25 MiB + MIME/magic boundary and PNG normalization; no network in tests |
| `image/chain.test.ts` | first healthy adapter wins and short-circuits; ordered fallthrough records every failed adapter; request passed through unchanged; all-fail error carries each diagnosis including non-`Error` throws; retryable only when every failure was transient; empty chain rejected |
| `image/factory.test.ts` | unset `IMAGE` uses the procedural floor; unknown and duplicate names warned and ignored once; unconfigured credentials/workflow skipped with every missing setting named and **not** recorded as degradation; all-unavailable falls back to procedural; configured order preserved with runtime failures in `degradedFrom`; first healthy adapter stops the chain; ComfyUI constructed from env workflow/output node; injected env only |
| `image/postprocess.test.ts` | palette correction re-encodes the still and reports the 6 ΔE cap; a matching scene is accepted with no regenerate and zero draw calls; an outlier regenerates exactly once with the same seed and the clause, and its lower distance is recorded; a second failure is accepted with no third call; the clause keeps a 1000-character prompt inside the contract; distance equal to the threshold is consistent (strict `>`); a regeneration error propagates without retry; seed/size mismatches, malformed requests and wrong reference bins rejected before drawing; decoder geometry and non-PNG encoder output rejected; injected decode/encode keeps the test offline |
| `vision/prompt.test.ts` | names the frame count, demands one JSON object, lists every answer key and every enum value, forbids palette/timings/invented characters, deterministic, rejects a frame count below one |
| `vision/parse.test.ts` | plain JSON, fenced blocks with and without a language tag, prose around the object, volunteered keys stripped, empty/no-object/malformed answers rejected, unknown enum reported with its field, missing key, duplicate ids, typography drift, excerpt capped at 200 chars |
| `vision/frames.test.ts` | selection keeps small lists, caps at 6 with first/last included, single-frame middle case, empty list and non-positive cap rejected; encode caps the long edge at 384 px, never upscales, returns base64 JPEG, rejects a failed or empty ffmpeg encode; `loadVisionFrames` makes one call per selected frame |
| `vision/cloudflare.test.ts` | env options name every missing variable and read model/timeout overrides; account-scoped URL, bearer token, `image[]` one entry per frame, prompt frame count, `max_tokens`; `result.response` and `result.description`; empty text is a permanent `UpstreamError`, 429 retryable, a bad answer is a `VisionResponseError`; model override in the URL |
| `vision/gemini.test.ts` | env options name the missing key and read overrides; `x-goog-api-key` header (not a query string), `inline_data` per frame, prompt part first, `responseMimeType: application/json`; text split across parts is joined; no candidates is a permanent `UpstreamError`, 503 retryable, a bad answer is a `VisionResponseError`; model override in the URL |
| `vision/heuristic.test.ts` | never invents medium/texture/characters/typography; thick ink + high contrast -> thick/cel clauses; flat profile -> none/flat; portrait from the measured aspect; clean border vs full bleed wording; deterministic; weight and shading thresholds |
| `vision/chain.test.ts` | first healthy answer wins with an empty degradation list; later adapter wins and records the order; every failure recorded; request passed through; all-fail error carries each diagnosis; `retryable` only when every failure was transient; empty chain rejected |
| `vision/factory.test.ts` | unset `STYLE` -> heuristic with a warning; unknown name warned and ignored; missing credentials skipped with the variables named; all unavailable -> heuristic; configured order preserved with `degradedFrom`; first healthy adapter short-circuits; injected env is used, not `process.env` |
| `adapter.chain` | first adapter throws → second is used → event records `degradedFrom` |
| `adapter.allfail` | every adapter down → `failed`, `step` correct, no charge |
| `ledger.atomic` | a throw after artifact write rolls back both the ledger and the step |

### 3.8 `services/media` (pytest)

| Test | Asserts |
|---|---|
| `test_synthesize.py` | real WAV fake → trimmed run per segment, `start_ms` == previous end + gap, boundary gaps from punctuation, words global/monotonic/inside run, 502 on provider failure, 422 on bad voice, response exposes both the WAV timing master and the encoded `master_mp3_path` |
| `test_stitch.py` | sample-exact starts and master length (48 frames/ms), head trim rebases words, words clamped inside the run, no clipping, join delta ≤ 200 (click check), assembled master inside the delivery window, internal word pause shortens the run and moves the later word by exactly the removed frames, a 900 ms sentence pause is cut to 320 ms and the later word moves by exactly the removed frames, the next word still starts where its sound starts, several pauses stay ordered, `pause_compression=False` reproduces the raw delivery |
| `test_pauses.py` | internal pauses 60–250 ms detected, edge silences left alone, a word pause shortened to 50 ms, a sentence pause (900 ms) shortened to 320 ms, the band boundary (350 ms) counted as a sentence, a paragraph pause (1400 ms) left alone, the sentence band switchable off, mixed bands cut to their own gaps and ordered, a pause shorter than the floor left alone, kept window configurable (2 × keep), PCM outside the cut byte-identical, frames after == before − removed, ascending non-overlapping cuts, an all-silent file is not cut to nothing |
| `test_audio.py` | silence detection at −45 dB, 20 ms headroom, 48 kHz mono PCM, −16 ±1.5 LU, fully silent input not trimmed to nothing, program stage keeps every frame, limits only when gain alone would break the true-peak ceiling, is a no-op when already on target |
| `test_cache.py` | key depends on engine/voice/text, audio+words round-trip exactly, half an entry is never served, corrupt entries are dropped not raised, bounded cache evicts oldest first, a failed synthesis is not cached, an unwritable cache does not fail the request, two identical requests call the engine once |
| `test_boundaries.py` | punctuation → boundary class, documented midpoint gaps, speed scaling, invalid speed rejected |
| `test_voices.py` | pinned ids, one speaker per pair (a second voice is rejected when the Tamil voice can already read English), both genders ship (`valluvar` male + `pallavi` female, both native ta-IN), four female voices are selectable (`pallavi`, `seraphina`, `vivienne`, `thalita`), a rejected female voice stays catalogued, a single-voice pair must be able to read English, explicit selector rules, ta-LK stays unpaired, JSON-ready catalogue |
| `test_asr.py` | raw-body `POST /transcribe` round-trip through a fake engine (language, duration, global word timings, segments), `transcript.json` artifact under `<request_id>/`, empty upload → 422, over `ASR_MAX_MB` → 413 before the engine runs, zero segments → 502 (never an empty success), `AsrUnavailableError` → 503, `AsrError` → 502, unknown exception → 502 without leaking its message; the default engine on an interpreter without faster-whisper answers 503 naming the package; (RUN_LIVE=1) synthesize a Tamil clip, transcribe the encoded master back: language ta/en, non-empty words, positive spans |
| `test_live_voices.py` | (LIVE=1) every pinned edge voice still exists; pairs still validate |
| `test_segment_plan.py` | ta/en/tanglish plan matches `packages/core` fixtures (cross-language parity) — not built yet |
| `test_live_tts.py` | (LIVE=1) mixed clip: ≥1 ta + ≥1 en run, one master file, monotonic words |

Cross-language parity matters: the Python service must route exactly like the TypeScript core,
or the editor's inspector will lie.

### 3.9 `services/render`

| Test | Asserts |
|---|---|
| `test_probe.py` | output duration within 100 ms of timeline, fps exact, resolution exact |
| `test_greenscreen.py` | corner pixels are #00FF00, captions still present |
| `test_tamil_shaping.py` | render a frame with `தமிழ்` + `ஸ்ரீ` and compare against a committed golden PNG (glyph shaping is the thing that silently breaks) |
| `test_determinism.py` | same input twice → same duration/fps/frame-hash for frame 30 |

### 3.10 `apps/web`

| Test | Asserts |
|---|---|
| Playwright `studio.spec` | paste script → pick style → create → poll → download works |
| Playwright `editor.spec` | redraw one scene, edit script → only changed scenes re-narrate |
| Playwright `a11y.spec` | axe: no critical violations on studio + editor |

---

## 4. Fakes

Every port has a deterministic fake, used by default in tests:

| Port | Fake behaviour |
|---|---|
| `PlannerPort` | there is no separate fake: the **heuristic adapter** is deterministic and offline, so tests use `createHeuristicPlanner()` (a plan derived from `packScenes()`, templated prompts, cycled motion, no emphasis). It is also the last link of the real chain, so the fake is exercised in production too. |
| provider HTTP | the adapters themselves are tested by a fake `fetch` (`vi.fn`) that returns the provider's envelope; no socket is opened. Live provider calls are `LIVE=1` only. |
| `TTSPort` | returns a generated sine/silence WAV of `chars/15` seconds + evenly spaced fake word timings |
| `ASRPort` | returns the known fixture transcript + timings |
| `ImagePort` | there is no separate fake: `createProceduralImageAdapter()` is deterministic, offline and part of the real fallback chain. It turns prompt/seed/profile into a valid palette-only PNG, so tests exercise the production floor rather than a second implementation. |
| `StylePort` | returns a fixed `StyleProfile` fixture |
| `RenderPort` | runs **real ffmpeg** (the only real thing in unit tests, because ffmpeg bugs are the bugs we care about) |
| `StoragePort` | in-memory map |
| `NotifyPort` | records deliveries |

No test may make a network call unless it is under `test:live`.

---

## 5. Golden artifacts

Committed under `fixtures/` (small, reviewable):

```
fixtures/scripts/tamil-mixed.txt        300 words
fixtures/scripts/tanglish.txt           300 words
fixtures/plans/tamil-mixed.plan.json
fixtures/styles/stickman.profile.json
fixtures/workflows/comfyui-sdxl-api.json  API-format placeholder example (model not bundled)
fixtures/render/tamil-frame.png         golden glyph-shaping frame
fixtures/tts/*.sha256                    digests of the 6 listening clips
```

Golden digests are **advisory** (a change forces re-listening, not a red build). Duration,
resolution, fps, loudness, and word-timing invariants are **hard failures**.

---

## 6. What "done" means per phase

A phase closes only when all four are true:

1. `npm run gate` + `pytest` green;
2. the phase's artifact check is demonstrated (video plays, audio is approved, API responds);
3. `docs/PROGRESS.md` ticked with a date and a one-line note on anything surprising;
4. any deviation from the specs is written into the relevant doc **before** moving on —
   docs are the contract, so an undocumented deviation is a bug.

---

## 7. Anti-patterns banned in this repo

- `test.skip` used to make CI green.
- Asserting on `toHaveBeenCalled` when the observable output is testable instead.
- Sleeping in tests instead of awaiting an event/condition.
- Any engine call inside a unit test.
- "Works on my machine" without a `docker compose up` path.
- Adding a feature just because another product has it, without a row in [01](./01-product-spec.md).
