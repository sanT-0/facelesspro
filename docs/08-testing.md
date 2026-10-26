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
"gate": "npm run typecheck && npm run lint && npm run test:unit && npm run test:contract"
```

| Command | What it covers | Speed target |
|---|---|---|
| `typecheck` | `tsc --noEmit`, strict, all packages | < 10 s |
| `lint` | eslint + import boundaries (`core` may not import `infra`) | < 10 s |
| `test:unit` | pure functions in `packages/core` | < 3 s |
| `test:contract` | api routes + worker steps with faked ports (in-memory pg or testcontainers) | < 60 s |
| `test:e2e` | full pipeline with fake engines + real ffmpeg on a 10 s video | < 90 s |
| `test:db` | `withStep` against live Postgres + pg-boss (`vitest.db.config.ts`) | < 30 s |
| `pytest` | `services/media` + `services/render` | < 60 s |
| `test:live` | opt-in `LIVE=1`, hits real providers | minutes |
| `sample:tts` | writes the 6 listening clips | minutes |

**Default CI runs everything except `live`, `sample:tts` and `test:db`.** Those exist for the
human gate or need a service; a gate must pass with no database running, or a missing Postgres
looks like green tests.

---

## 3. Test matrix by layer

### 3.1 `packages/core` (pure, no I/O)

| File | Asserts |
|---|---|
| `segmenter.test.ts` | Tamil/en/tanglish labelling, run merging, punctuation preservation, "no two adjacent runs share a lang", overrides |
| `transliterate.test.ts` | 300-pair golden table, residual passthrough, never throws on emoji/digits/combining marks |
| `numbers.test.ts` | ta vs en expansion of 2024 / ₹500 / 3pm / 50% / 1,20,000 |
| `scenes.test.ts` | char budget, min/max scenes, `concat(text) === script`, deterministic fallback |
| `captions.test.ts` | line breaking, word limit, Tamil grapheme clusters never split, cue monotonicity |
| `timeline.test.ts` | global = run.start + word.local; gaps by boundary class; no overlaps |
| `pricing.test.ts` | unit-cost math matches the table; `ceil` boundaries; zero-minute guard |
| `ass.test.ts` | ASS document well-formed, style ids reference real styles, font names bundled |

Property tests (fast-check) for the timing invariants: 10k random voice plans must produce a
monotonic, gap-respecting, non-overlapping timeline.

### 3.2 `packages/contracts` (zod only, no I/O)

| File | Asserts |
|---|---|
| `requests.test.ts` | every documented default (V3 stability 50, V2 stability 38 + style 50, roblox pitch 140, TTS 38); script limit per aspect; exactly one of script/voiceover; https-only webhook with localhost rejected; unknown keys rejected; all 16 V2 and 9 quiz image styles; unknown `characterId`; `correctIndex` bounds; `{{answer}}` required; 100-item and 1000-message caps; caption-template id 0 invalid |
| `transport.test.ts` | the error-code table (11 codes → documented statuses); create vs read video shape; webhook body embeds the same video schema; 10 attempts = 9 gaps totalling ~24 h; signature covers `t.body`; synthesize request parity with pydantic; the Python timeline parses including `+00:00`/microseconds; cache-stats union |
| `db.test.ts` | one realistic row for each of the 17 tables; `credits` required and nullable; caption-template id 0 rejected; the upstream `create image` spelling rejected; narration requires a voice plan |

Because these schemas are the single shape source, a red contract test blocks api, worker, web
and mcp at once — that is the point.

### 3.3 `apps/api`

| Test | Asserts |
|---|---|
| `health` | shape + version |
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

`jobs.test.ts` runs in `npm run gate`, no database:

| Test | Asserts |
|---|---|
| `jobs.test.ts` | queue name == step id for every contract step; `parseJob` rejects a non-object payload, a missing/malformed `videoId`, and an unknown queue (before looking at the payload); `jobData` drops everything but `videoId`; `nextStepOf` follows the public order and returns `null` after `render`; queue policy is 2 retries with backoff, 1 h expiry, 1 day retention; the default lock TTL is 30 min |

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
| `step.idempotent` | running a step twice charges once, produces one artifact |
| `step.resume` | kill between `create-images` and `create-captions` → resume skips completed scenes |
| `adapter.chain` | first adapter throws → second is used → event records `degradedFrom` |
| `adapter.allfail` | every adapter down → `failed`, `step` correct, no charge |
| `ledger.atomic` | a throw after artifact write rolls back both the ledger and the step |

### 3.7 `services/media` (pytest)

| Test | Asserts |
|---|---|
| `test_synthesize.py` | real WAV fake → trimmed run per segment, `start_ms` == previous end + gap, boundary gaps from punctuation, words global/monotonic/inside run, 502 on provider failure, 422 on bad voice |
| `test_stitch.py` | sample-exact starts and master length (48 frames/ms), head trim rebases words, words clamped inside the run, no clipping, join delta ≤ 200 (click check), assembled master inside the delivery window |
| `test_audio.py` | silence detection at −45 dB, 20 ms headroom, 48 kHz mono PCM, −16 ±1.5 LU, fully silent input not trimmed to nothing, program stage keeps every frame, limits only when gain alone would break the true-peak ceiling, is a no-op when already on target |
| `test_cache.py` | key depends on engine/voice/text, audio+words round-trip exactly, half an entry is never served, corrupt entries are dropped not raised, bounded cache evicts oldest first, a failed synthesis is not cached, an unwritable cache does not fail the request, two identical requests call the engine once |
| `test_boundaries.py` | punctuation → boundary class, documented midpoint gaps, speed scaling, invalid speed rejected |
| `test_voices.py` | pinned ids, pair validation (language/gender/engine), explicit selector rules, ta-LK stays unpaired, JSON-ready catalogue |
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
| `PlannerPort` | returns a fixed 5-scene plan derived from the script's sentence count |
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
