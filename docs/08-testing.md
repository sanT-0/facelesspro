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
| `test:db` | `withStep` against live Postgres + pg-boss (`vitest.db.config.ts`) | < 30 s |
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
| `ass.test.ts` | ASS document well-formed, style ids reference real styles, font names bundled |
| `samples.test.ts` | one sample directory per pair id, every set under `samples/tts`, and non-ids rejected (engine voice id, absolute path, `..`) |
| `sentences.test.ts` | Tamil/Latin terminators, abbreviations (`Dr.`, `Rs.500`, `p.m.`, `திரு.`), decimals, initials, ellipsis, closing quotes, Tamil quotatives (`"…?" என்று` stays one sentence), paragraph breaks, offsets into the normalised script, `concat === script` |
| `duration.test.ts` | ta 130 / en 150 / mixed 140 wpm, per-word blend, numbers expanded before counting, `₹1,20,000` = 5 words not 1 and unspellable digits keep the mixed rate, one 300 ms gap per sentence, `durationMs`, zero for silence, override rates, rate validation |

Property tests (fast-check) for the timing invariants: 10k random voice plans must produce a
monotonic, gap-respecting, non-overlapping timeline.

### 3.2 `packages/contracts` (zod only, no I/O)

| File | Asserts |
|---|---|
| `requests.test.ts` | every documented default (V3 stability 50, V2 stability 38 + style 50, roblox pitch 140, TTS 38); script limit per aspect; exactly one of script/voiceover; https-only webhook with localhost rejected; unknown keys rejected; all 16 V2 and 9 quiz image styles; unknown `characterId`; `correctIndex` bounds; `{{answer}}` required; 100-item and 1000-message caps; caption-template id 0 invalid |
| `transport.test.ts` | the error-code table (11 codes → documented statuses); create vs read video shape; webhook body embeds the same video schema; 10 attempts = 9 gaps totalling ~24 h; signature covers `t.body`; synthesize request parity with pydantic; the Python timeline parses including `+00:00`/microseconds; cache-stats union |
| `db.test.ts` | one realistic row for each of the 17 tables; `credits` required and nullable; caption-template id 0 rejected; the upstream `create image` spelling rejected; narration requires a voice plan |
| `planner.test.ts` | adapter and motion vocabularies pinned; a heuristic-shaped plan parses; `degradedFrom` keeps the order tried; unknown motion, empty text/prompt, over-long prompt rejected; zero-length scene, overlap, a first scene not at 0, `totalMs ≠ last endMs`, empty plan, >120 scenes, unknown keys all rejected |

Because these schemas are the single shape source, a red contract test blocks api, worker, web
and mcp at once — that is the point.

### 3.3 `apps/api`

| Test | Asserts |
|---|---|
| `health` | `200` when both probes resolve, `503` when either throws or hangs; a hung probe is cut at the deadline, not waited on; `status` is derived from the components; the body parses through `healthSchema` and never contains the probe's error text |
| `auth` | missing / malformed / revoked / other-workspace key → 401 |
| `create.ai-videos-v3` | required fields, both script+voiceover → 400, neither → 400, bad size for style → 400 |
| `create.defaults` | every documented default is applied exactly |
| `status` | status/step transitions; `render` while processing → 409 |
| `webhooks` | http:// rejected, localhost rejected, signing header present |
| `errors` | codes table from [07](./07-api-and-mcp.md#12-errors-p) is exhaustive |
| `mcp.tools` | tool list matches the endpoint list 1:1 (a test, not a convention) |

### 3.4 `packages/db` (schema only, no network)

| Test | Asserts |
|---|---|
| `schema.test.ts` | the 17 tables are exactly `DB_TABLES`; every column name matches its contract row schema; the three public enums are built from the contract tuples; `workspace.credits` is nullable; `caption_tpl.id` is an integer primary key; built-in templates have unique negative ids; the dev workspace is `selfhost` with `credits = null`; compile-time `$inferSelect` ⊇ contract row for five tables |
| `timestamp.test.ts` | Postgres text (`2026-10-26 18:12:34.567+00`) → ISO UTC; real offsets (+05:30, −04:00, +05:45) converted, not stripped; already-ISO input stable; missing fraction filled; output passes `isoDateTimeSchema`; microseconds truncated (documented); unparseable passthrough; `infinity` preserved; `created_at.mapFromDriverValue` normalises the exact string drizzle hands back |
| `client.test.ts` | the default connection string agrees with `.env.example`; an empty `DATABASE_URL` falls back; `loadEnv` is silent with no `.env` |

The migration itself is verified by running it (docs/09 P0), not by a unit test: `npm run
db:migrate` twice must report `17 tables, 1 migrations applied` then `0 new caption templates`.

### 3.5 `packages/queue` (hermetic) + `test:db` (Postgres)

`jobs.test.ts`, `ping.test.ts` and `health.test.ts` run in `npm run gate`, no database:

| Test | Asserts |
|---|---|
| `jobs.test.ts` | queue name == step id for every contract step; `parseJob` rejects a non-object payload, a missing/malformed `videoId`, and an unknown queue (before looking at the payload); `jobData` drops everything but `videoId`; `nextStepOf` follows the public order and returns `null` after `render`; queue policy is 2 retries with backoff, 1 h expiry, 1 day retention; the default lock TTL is 30 min |
| `ping.test.ts` | `ping` payload is a strict object with an optional trimmed note (blank/oversized/non-string rejected); the queue never retries and keeps the row for a day; `consume` subscribes once with `batchSize: 1`, parses every job, and fails the whole batch on the first malformed payload instead of skipping it |
| `health.test.ts` | `expectedQueueNames()` is the five steps in contract order plus `ping`; `checkQueues` resolves only when every queue row exists, names all missing ones, passes names as a query parameter (never interpolated), honours a custom schema, rejects a schema that is not a plain identifier, and propagates a database error |

`step.db.test.ts` runs only under `npm run test:db` (`vitest.db.config.ts`, `DB_TESTS=1`),
against `docker compose` Postgres:

| Test | Asserts |
|---|---|
| commit | artifact + ledger row + `status`/`step` cursor + next job all land; `videoRowSchema` parses the row; credits 100 → 97 |
| stale | a job for a step the video already left is dropped, body never called |
| locked | a live lock returns `locked` with `retryAfterMs`, body never called, the lock is untouched |
| expired | a 31-minute-old lock is reclaimed with `attempt + 1` |
| failure | `status=failed`, `error={code,message}`, step kept, credits and ledger unchanged, lock released |
| retryable | rethrows the same `StepFailure`, video still `processing`, lock released so the next claim is immediate |
| atomicity | a throw after artifact write + charge + enqueue rolls back all three: no `video_url`, no ledger row, no queued job |
| credits | `insufficient_credits` fails the step without debiting; an unlimited workspace (null credits) records usage without inventing a balance |
| reused | `{ reused: true }` advances the cursor with no charge and no ledger row |
| superseded | an attempt whose lock was taken over returns `superseded`, charges nothing, and leaves the winner's lock intact |
| missing | a deleted video is dropped, not retried |
| no commit | a body that neither commits nor reports `reused` fails with `internal` |
| concurrency | two jobs for one `(video, step)` run the body once: the second sees `locked` while the first holds it |

### 3.6 `apps/worker`

| Test | Asserts |
|---|---|
| `ping` | `startWorker` consumes exactly the `ping` queue while the pipeline is unbuilt; a job is logged and resolves (so pg-boss marks it completed); a malformed payload throws `InvalidJobError` rather than being swallowed; `stop()` calls `offWork` for every queue it started and nothing else |
| `step.idempotent` | running a step twice charges once, produces one artifact |
| `step.resume` | kill between `create-images` and `create-captions` → resume skips completed scenes |
| `planner.heuristic` | the fixture plans into a valid 8–20 s plan; `concat(text) === script`; style prefix/suffix/negative land in every prompt; prompts ≤1000 chars and trimmed by whole word (never inside a Tamil cluster); punctuation and emoji stripped from descriptions; motion cycles; no emphasis invented without a model; a slower voice gets more scenes; the cap is honoured past 20 s; empty script rejected; deterministic |
| `planner.chain` | first healthy adapter wins with empty `degradedFrom`; each failure falls through and is recorded in order; all-fail throws `PlannerChainError` with every adapter's message; a non-`Error` rejection survives as text; an empty chain is rejected at construction |
| `adapter.chain` | first adapter throws → second is used → event records `degradedFrom` |
| `adapter.allfail` | every adapter down → `failed`, `step` correct, no charge |
| `ledger.atomic` | a throw after artifact write rolls back both the ledger and the step |

### 3.7 `services/media` (pytest)

| Test | Asserts |
|---|---|
| `test_synthesize.py` | real WAV fake → trimmed run per segment, `start_ms` == previous end + gap, boundary gaps from punctuation, words global/monotonic/inside run, 502 on provider failure, 422 on bad voice |
| `test_stitch.py` | sample-exact starts and master length (48 frames/ms), head trim rebases words, words clamped inside the run, no clipping, join delta ≤ 200 (click check), assembled master inside the delivery window, internal word pause shortens the run and moves the later word by exactly the removed frames, the next word still starts where its sound starts, several pauses stay ordered, `pause_compression=False` reproduces the raw delivery |
| `test_pauses.py` | internal pauses 60–250 ms detected, edge and sentence/long silences left alone, a pause shorter than the floor left alone, kept window configurable (2 × keep), PCM outside the cut byte-identical, frames after == before − removed, ascending non-overlapping cuts, an all-silent file is not cut to nothing |
| `test_audio.py` | silence detection at −45 dB, 20 ms headroom, 48 kHz mono PCM, −16 ±1.5 LU, fully silent input not trimmed to nothing, program stage keeps every frame, limits only when gain alone would break the true-peak ceiling, is a no-op when already on target |
| `test_cache.py` | key depends on engine/voice/text, audio+words round-trip exactly, half an entry is never served, corrupt entries are dropped not raised, bounded cache evicts oldest first, a failed synthesis is not cached, an unwritable cache does not fail the request, two identical requests call the engine once |
| `test_boundaries.py` | punctuation → boundary class, documented midpoint gaps, speed scaling, invalid speed rejected |
| `test_voices.py` | pinned ids, one speaker per pair (a second voice is rejected when the Tamil voice can already read English), both genders ship (`valluvar` male + `pallavi` female, both native ta-IN), four female voices are selectable (`pallavi`, `seraphina`, `vivienne`, `thalita`), a rejected female voice stays catalogued, a single-voice pair must be able to read English, explicit selector rules, ta-LK stays unpaired, JSON-ready catalogue |
| `test_live_voices.py` | (LIVE=1) every pinned edge voice still exists; pairs still validate |
| `test_segment_plan.py` | ta/en/tanglish plan matches `packages/core` fixtures (cross-language parity) — not built yet |
| `test_live_tts.py` | (LIVE=1) mixed clip: ≥1 ta + ≥1 en run, one master file, monotonic words |

Cross-language parity matters: the Python service must route exactly like the TypeScript core,
or the editor's inspector will lie.

### 3.8 `services/render`

| Test | Asserts |
|---|---|
| `test_probe.py` | output duration within 100 ms of timeline, fps exact, resolution exact |
| `test_greenscreen.py` | corner pixels are #00FF00, captions still present |
| `test_tamil_shaping.py` | render a frame with `தமிழ்` + `ஸ்ரீ` and compare against a committed golden PNG (glyph shaping is the thing that silently breaks) |
| `test_determinism.py` | same input twice → same duration/fps/frame-hash for frame 30 |

### 3.9 `apps/web`

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
| `TTSPort` | returns a generated sine/silence WAV of `chars/15` seconds + evenly spaced fake word timings |
| `ASRPort` | returns the known fixture transcript + timings |
| `ImagePort` | returns a deterministic SVG→PNG with the prompt's hash rendered |
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
- Adding a feature because vsub has it, without a row in [01](./01-product-spec.md).
