# PROGRESS

Living checklist. Update **at the end of every task**, not at the end of a phase.
Format: `[x] date — note`. Anything surprising goes in the note.

---

## Documents

- [x] 2026-10-26 — `plan.md` (master plan, phases, gates, definition of done)
- [x] 2026-10-26 — `README.md` (what it is, layout, doc index)
- [x] 2026-10-26 — `docs/01-product-spec.md` (feature + field-level contract)
- [x] 2026-10-26 — `docs/02-reverse-engineering.md` (REA evidence log)
- [x] 2026-10-26 — `docs/03-architecture.md` (services, data model, ports)
- [x] 2026-10-26 — `docs/04-pipeline.md` (steps, artifacts, resumability)
- [x] 2026-10-26 — `docs/05-tts-tamil-mixed.md` (the differentiator)
- [x] 2026-10-26 — `docs/06-free-sources.md` (engines + swap strategy)
- [x] 2026-10-26 — `docs/07-api-and-mcp.md` (REST + MCP surface)
- [x] 2026-10-26 — `docs/08-testing.md` (code → test → next)
- [x] 2026-10-26 — `docs/09-roadmap.md` (P0–P11 tasks + gates)
- [x] 2026-10-26 — `docs/10-operations.md` (run, cost, failure playbook)
- [x] 2026-10-26 — `docs/11-legal-and-compliance.md` (licences, consent, what not to copy)
- [x] 2026-10-26 — `AGENTS.md` (working agreement for future sessions)

## Environment baseline (verified 2026-10-26)

- [x] `npm install` → 75 packages
- [x] `npm test` → **26 tests passing** (segmenter 24, api 2) — the green starting line
- [x] `ffmpeg 9.0.2-full_build` present on PATH
- [x] `python 3.14.6` present ⚠️ *very new*: `ctranslate2` / `faster-whisper` wheels may not
      exist for 3.14 yet. If P1/P6 ASR install fails, run the media service on 3.12 and record
      the decision here instead of fighting the interpreter.

## Reverse engineering

- [x] 2026-10-26 — REA MCP registered for OpenCode (207 tools, `rea-agents@6.7.0`)
- [x] 2026-10-26 — client bundle mirror analysed (36 files, 34 parsed, 354,669 AST nodes)
      evidence `ev_925a537540e6119a2687f1a734622aca4813369e39d1d394b8cf72e57b13e9e1`
- [x] 2026-10-26 — public API + MCP docs transcribed into `01`/`07`
      note: one chunk exceeded the 1 GiB heap; 11 inline scripts unanalysed → endpoints from
      those are unknown (absence of evidence, not evidence of absence)
- [ ] optional — browser/network capture of the authenticated editor, only if exact payloads
      become necessary

## P0 Foundation

- [x] 2026-10-26 - scope rename `@stickman/*` → `@facelesspro/*`: both package names, `apps/api`,
      `packages/art`'s dependency, `tsconfig` paths, `vitest` alias, root `name`, `dev:api`
      workspace; service ids `facelesspro-api` / `facelesspro-media`;
      `package-lock.json` regenerated; compose `container_name`/user/db → `facelesspro-postgres` /
      `faceless` (was the only place still disagreeing with `.env.example`'s
      `postgresql://faceless:faceless@…/faceless`).
      Left alone deliberately: `fixtures/styles/stickman.profile.json` is an art-style *name*, not
      a package scope.
      gate: 260 tests / 7 files exit 0; pytest 91 passed, 3 skipped; ruff clean.
      Surprise: none — but `npm install` warns that `esbuild`'s postinstall is not allow-listed on
      this machine, which is a local npm policy, not a repo change.
- [x] 2026-10-26 - `packages/contracts` (`@facelesspro/contracts`, zod 4.6.7): `common` (enums,
      limits, https/localhost webhook rules), `errors` (11 codes → statuses), `requests` (V3, V2,
      quiz, fake text, roblox, caption, commentary, TTS, screenshot, render spec), `responses`
      (create/read video, art styles, voices + pairs, captions, libraries, plans, ledgers, assets),
      `media` (synthesize + timeline + narration plan — mirrors the pydantic models), `webhooks`,
      `db` (17 row schemas). 48 tests, gate green at 308.
      Decisions pinned in the same change: exactly one of `script`/`voiceoverUrl`; `voiceStyle`
      ranges 0–100 with speed 50–200; `Plan.maxResolution` 1080/1440/2160 (the old `4320` was an
      8K tier no endpoint offers); unlimited plan values are `null`, never `Infinity`;
      500/`internal` added to the error table; unknown request keys are rejected, not dropped.
      Surprise: zod reports an unknown key at the *object root* with an empty path, so the
      strict-object test asserts on the message rather than a path.
      Known gap, recorded rather than guessed: `conversations[].messages[]` for fake-text was never
      observed in the recovered bundles. We model `{text, characterId?}` and will widen it if a
      capture shows more.
- [x] 2026-10-26 - Postgres + Drizzle (`@facelesspro/db`, drizzle-orm 0.45.4 / drizzle-kit 0.31.11 /
      pg 8.23.1): 17 tables in `schema.ts`, one committed migration
      (`packages/db/migrations/0000_*.sql`), `db:generate` / `db:migrate` / `db:seed` scripts,
      seed of 3 built-in caption templates (ids −1/−2/−3) + a `selfhost` dev workspace with
      `credits = null`. 20 tests (`schema`, `timestamp`, `client`); gate green at 328.
      Property names are snake_case so `$inferSelect` matches the contract row types exactly;
      only `video_status` / `video_step` / `member_role` are real Postgres enums, built from the
      contract tuples.
      Observed: `db:migrate` twice → `17 tables, 1 migrations applied, 3 new caption templates`
      then `17 tables, 1 migrations applied, 0 new caption templates`; a drizzle
      insert→select→delete round-trip parsed cleanly through `videoRowSchema`, and psql shows the
      three enums with the exact contract labels.
      Surprise (the one that cost the time): `types.setTypeParser(1184, …)` **does not work** for
      drizzle. Drizzle hands `pg` a `getTypeParser` that returns its identity function and then
      maps each column itself, so Postgres's `2026-10-26 18:12:34.567+00` reached the contract
      untouched and every row failed `isoDateTimeSchema`. Fix: a `customType` whose `fromDriver`
      normalises to ISO 8601 UTC (`packages/db/src/timestamp.ts`), which also keeps `$inferSelect`
      a `string` instead of a `Date`. Microseconds truncate to milliseconds — documented, and
      `created_at` is not a total ordering anyway because `now()` is transaction-scoped.
      Also: plans are code, not rows, so the seed creates no plan table; docs/09 wording fixed
      in the same change instead of inventing a table to satisfy it.
- [x] 2026-10-26 - pg-boss 10.4.2 + `withStep` (`@facelesspro/queue`). One queue per step,
      named after the step id, so queue names are the same public vocabulary as `video.step`.
      Payload is only `{videoId}`; everything else is in the normalised `video.request`.
      `withStep` outcomes: `committed | reused | stale | locked | superseded | failed | missing`.
      Claim is a short transaction (`select … for update` on `video`, then `job_lock`); commit
      opens a connection-level transaction, re-checks the cursor and that the lock still carries
      our `attempt`, then runs the body, deletes the lock and commits. `charge()` writes the
      ledger row and debits the workspace under a row lock; `enqueue()` inserts the next job
      through pg-boss's `{ db }` hook on the *same connection*, which is why the queue is
      Postgres. 26 tests: 12 hermetic (`jobs.test.ts`, in the gate) + 14 integration
      (`step.db.test.ts`, `npm run test:db`).
      Observed: gate green; `test:db` green at 14/14 twice in a row (workspace-per-test cascade,
      queues purged per test). The atomicity test throws after artifact + charge + enqueue and
      finds all three rolled back. Two concurrent jobs: the second returns `locked` and its body
      is never called.
      Surprises: (a) a released lock restarts at `attempt = 1`, so `attempt` is a fence for one
      lock's lifetime, not a retry counter - the test now pins that instead of pretending
      otherwise; (b) drizzle's `Database` type only matches `drizzle(client, { schema })` if both
      use the schema *map* rather than the module namespace, so `client.ts` now imports
      `{ schema }` (the enums are values, not relations).
      Deviation from docs/04 §7, fixed in the same change: a step commits once, so a crash
      redoes that step rather than skipping already-drawn scenes; the spec now says so.
- [x] 2026-10-27 - worker skeleton + `/health {db,queue}` (roadmap P0 item).
      `apps/worker` (`@facelesspro/worker`): `startWorker({ boss })` consumes exactly one queue —
      `ping` (`retryLimit: 0`) — through the new generic `consume()` in `@facelesspro/queue`;
      `stop()` calls `offWork` per queue, `main.ts` drains on SIGINT/SIGTERM. Pipeline step
      handlers are deliberately absent until P5, so an enqueued step job stays visible in
      `pgboss.job` instead of being failed by a handler that does not exist.
      `apps/api` now exports `createApp(deps)` with injected probes (no module-level app, so a
      test can never accidentally become an integration test). `/health` runs `select 1` and
      `checkQueues()` concurrently under a 2 s deadline each, derives `status`, and answers
      `200 ok` / `503 degraded`. The body is `healthSchema` in `@facelesspro/contracts`, which
      also refuses `status:"ok"` when a component is `error`.
      `checkQueues()` reads pg-boss's own `queue` table and requires all five step queues plus
      `ping` — a TCP connect cannot see a missing queue.
      `npm run ping` enqueues one ping and polls until `completed`, so the artifact check is an
      exit code.
      gate: `npm run typecheck` clean; `npm test` 386 passed / 19 files; `npm run test:db`
      14 passed. pytest not run (no media/render files touched).
      Observed against compose Postgres: `/health` → `200 {"status":"ok",…,"db":"ok","queue":"ok"}`;
      worker+api booted, `npm run ping -- hello-from-p0` → `completed in 2073 ms`, and
      `pgboss.job` shows the row with `state=completed`, `started_on` and `completed_on` set and
      `data={"note":"hello-from-p0"}`; `pgboss.queue` has `ping` at `retry_limit 0`,
      `expire_seconds 60`. A second api with `DATABASE_URL` pointing at a dead port answered
      `503 {"db":"error","queue":"error"}`; a third with `PGBOSS_SCHEMA=no_such_schema` answered
      `503 {"db":"ok","queue":"error"}`.
      Surprises: (a) pg-boss 10 stores unprefixed tables in the `pgboss` schema
      (`pgboss.queue`, `pgboss.job`) and keeps its own `__pgboss__send-it` queue row, so the
      health check must expect **extra** rows, not an exact set; (b) `getJobById(queue, id)`
      takes the queue first — the ping script found that by failing; (c) 2.07 s for a no-op ping
      is pg-boss's ~2 s polling interval, not work — a latency budget for P5 must account for it;
      (d) `JobConsumer.work` cannot be generic and also fakeable, so the consumer contract types
      the payload as `unknown`: off a queue, that is the honest type anyway.
      Note: this session started with no `node_modules` and a stopped Docker engine, so
      `npm install` + starting Docker Desktop were part of the work. The machine also runs an
      unrelated PostgreSQL 18 service on 5432; everything here used compose on 5433, as
      `.env.example` says.
- [x] 2026-10-27 - `npm run gate` is now `typecheck && lint && test`, with boundaries enforced by
      eslint (`eslint@10.13.0` + `typescript-eslint@8.72.1`, flat `eslint.config.js`, no
      type-aware rules so lint stays ~2 s). Rules, not prose: `packages/core` may import only
      relative files and may not use `Date`/`process`/`fetch`/`setTimeout`/`crypto`/`Math.random`;
      `packages/contracts` may import `zod` only; no package may import `apps/*`; deep
      `@facelesspro/*/src/*` imports are rejected (barrel only); `apps/api` may not import
      `pg-boss`/`pg`/`drizzle-orm` and `apps/worker` may not import `pg-boss`/`pg`.
      `test:unit`/`test:contract` were **not** created — one `test` runs every hermetic suite, and
      the split becomes a vitest project only when a suite needs different isolation (docs/08 §2
      amended in the same change, since docs are the contract).
      `.env.example` rewritten: ASCII banners, trailing comments removed, `PGBOSS_SCHEMA`
      documented, `FONTCONFIG_FILE` commented until P4 ships `packages/art/fonts/fonts.conf`,
      script/test knobs (`PYTHON`, `TTS_PORT`, `TTS_PAIR`, `RUN_LIVE`) listed. docs/03 §7 gained
      `PGBOSS_SCHEMA` and the missing `procedural` image adapter.
      gate: typecheck clean; `eslint .` 62 files / 0 errors; `npm test` 386 passed / 19 files;
      `npm run test:db` 14 passed.
      Artifact check (deliberate violations, then reverted): `import 'node:fs'` + `import 'zod'` +
      `Date.now()` in `packages/core/src/index.ts` → 3 errors naming "core is dependency-free" and
      "core takes time as an argument"; `import 'pg-boss'` + `@facelesspro/db/src/client` in
      `apps/api/src/health.ts` → 2 errors ("must not know the vendor", "import the package
      barrel"). Clean again after reverting.
      Lint found three pieces of pre-existing dead code that `tsc` cannot see (`noUnusedLocals` is
      off): a `delta` accumulator in `numbers.ts` that was incremented and never read, and unused
      type/table imports in `db/src/schema.ts` and `db/src/schema.test.ts`. Removed; behaviour
      unchanged (same 386 tests).
      Surprises: (a) `no-restricted-imports` patterns cannot express "relative imports only" —
      ESLint normalises `./x` before matching, so `group: ['*', '!./*']` still flagged every
      relative import; the core rule is now an explicit deny list plus the globals rules, and the
      `package.json` with zero deps is the backstop for anything unlisted; (b) Node's `.env`
      loader *does* strip a trailing `# comment` (verified `FOO=bar # note` → `bar`), so the old
      inline comments were harmless — moved to their own lines anyway for readability.
- [x] 2026-10-27 - CI workflow (`.github/workflows/ci.yml`): `gate` job (ubuntu, node 22 = the
      `engines` floor, `actions/setup-node` with npm cache, `npm ci`, `npm run gate`) and `python`
      job (3.12 per plan.md §5, pip cache on `services/media/requirements*.txt`,
      `apt-get install ffmpeg`, `ruff check app tests`, `python -m pytest`). Least privilege
      (`contents: read`), one run per ref with cancel-in-progress, no branch filter,
      `workflow_dispatch` included. `test:db`/`test:live`/`sample:tts` stay out (docs/08 §2):
      `test:db` needs a service container, which is its own task.
      Verified locally, not on GitHub: `npx js-yaml .github/workflows/ci.yml` parses; `npm ci`
      succeeds against the committed lockfile, then `npm run gate` → typecheck + lint + 386 tests
      green; `ruff check app tests` clean and `python -m pytest` 91 passed / 3 skipped (live) —
      but on Python 3.14/ffmpeg 9.0.2, because this machine has no 3.12 interpreter, so the
      runner's first execution is still the real proof.
      Surprises: none in the workflow itself. Worth knowing: `on:` unquoted parses as a key
      under js-yaml's default schema, but GitHub requires the key spelled `on` — it is, and it
      stays `on` because this file is not parsed by our own code. Also the earlier local
      `npm install -D eslint` had already refreshed the lockfile, so `npm ci` was a genuine
      lock-sync test rather than a formality.
      Assumed until the runner proves it: ubuntu's apt `ffmpeg` (6.x) has every filter the audio
      tests use (`loudnorm`, `alimiter latency`, `silenceremove`), which this machine's 9.0.2
      build cannot demonstrate for it.
- [ ] P0 close-out: first green CI run on the remote (needs a push).

## P1 Tamil + English TTS ⭐

- [x] 2026-10-26 — pre-existing: script-aware segmenter + 170-word Tanglish lexicon, 196 test lines
- [x] 2026-10-26 — pre-existing: edge-tts engine with `WordBoundary` timings, `/synthesize`
- [x] 2026-10-26 — lexicon file + morphology heuristic
      `packages/core/data/tanglish.json` (651 entries, 647 unique after de-dupe) +
      `packages/core/src/lexicon.ts` loader (`createLexicon`/`extendLexicon`/`isTanglishWord`).
      21 new tests; gate green at 47 tests.
      Surprise: most inflected forms (`veetukku`, `velaikku`) are *also* literal word entries, so
      proving the `morphology:false` switch needs a morphology-*only* fixture (`oorukku` =
      `ooru`+`kku`). Tests were wrong, not the code.
- [x] inline overrides `[[ta:…]] [[en:…]] [[tl:…]]`
      `packages/core/src/overrides.ts` — 23 tests. Malformed markers stay verbatim (a
      half-typed marker must never delete words); forced words merge with same-language
      neighbours instead of fragmenting the track.
      Surprise: my first two assertions expected extra run splits — the merge behaviour is
      correct and the tests were wrong.
- [x] 2026-10-26 — transliteration: `packages/core/src/transliterate.ts` +
      `data/tanglish-ta.json` (442 entries, 428 of 647 routed words pinned) + `npm run tts:audit`.
      68 tests; gate green at 138.
      Surprise: Tanglish is **not** a consistent romanisation (`o` is `ொ` in sollu but `ோ` in
      podu; `nn` is `ண்ண` in pannu but `ன்ன` in enna), so the spec's rule-engine-only design was
      replaced with dictionary-first, rules-second.
      Three bugs found by the audit/probe, all fixed: `ng` swallowed the `g` (உஙலொட),
      word-final `n` emitted a doubled virama (பய்யன்்), and `transliterateTanglish` bypassed
      the override parser so `[[en:…]]` markers were themselves transliterated.
      Honest limit: the Tamil forms were authored here; structural validity is tested,
      correctness is for the listening gate.
- [x] 2026-10-26 - number/date expansion: `packages/core/src/numbers.ts`
      (`numberToWords` / `expandNumbers` / `expandNumbersContextual`), 103 tests; gate green
      at 239.
      Surprise: the first `tamilLink` stripped one character from `…ம்` bases, producing
      `இரண்டாயிரமத்து`; the joiners must drop the whole `ம்` (`இரண்டாயிரத்து`). Second surprise:
      a connector is language-specific, so `1947` is `ஆயிரத்து தொள்ளாயிரத்து…` in Tamil but
      `nineteen forty-seven` in English — the year heuristic is English-only by design.
      Limit found by the artifact probe, not the unit tests: a Tamil case suffix glued to a number
      (`2024-ல்`, `50%க்கு`) stays written as-is (`…நான்கு-ல்`), which TTS will read as two
      pieces. Fixing it needs sandhi + listening, so it is scheduled, not guessed at.
- [x] 2026-10-26 - voice catalogue + pairing: `services/media/app/voices.py` (9 voices, 4 pairs,
      gender/engine/language validation, `resolve_pair()` / `voice_for_lang()`) + `test_voices.py`
      (22 tests) + `test_live_voices.py` (`RUN_LIVE=1`, re-checks Microsoft's live list).
      gate: pytest 35 passed, 3 skipped (live).
      Observed, not assumed: `python -m edge_tts --list-voices` shows exactly four Tamil voices
      (`ta-IN-PallaviNeural`, `ta-IN-ValluvarNeural`, `ta-LK-SaranyaNeural`,
      `ta-LK-KumarNeural`) and both `en-IN` voices used by the pairs.
      Surprise: the `ta-LK` voices cannot be paired with `en-IN` without an accent clash, so they
      are catalogued but unpaired; a test now fails if someone pairs one by accident.
      Bug found: `pytest services/media/tests` failed at collection because starlette 1.6 requires
      `httpx2`, while `requirements-dev.txt` still pinned `httpx` (not even installed). Fixed the
      requirement, installed `httpx2==2.16.0`, and recorded the starlette rename in docs/05 §3.5.
- [x] 2026-10-26 - stitching: `services/media/app/{boundaries,audio,stitch}.py`. Gaps come from
      the punctuation between runs (0/110/180/300/475 ms midpoints), each run is trimmed at −45 dB
      with 20 ms headroom, loudness-matched per run to −16 LUFS / −1.5 dBTP (two-pass, linear),
      faded 5 ms equal-power, and concatenated from the same frame counters as the timeline.
      `run.start_ms` and global words are now emitted; `master.wav` + `master.mp3` + `timeline.json`
      per request. 91 pytest tests (3 live, skipped).
      Observed on a real 4-run ta/en clip: 16.280 s, −16.24 LUFS, −1.50 dBTP, trims 174–230 ms,
      sentence gaps 300 ms, 38 monotonic words, every word inside its run.
      *(Superseded: per-run peaks left the quiet runs below target; the program stage below fixes
      the assembled programme, and `−16.24` above was measured on a clip whose runs happened to be
      long enough to escape it.)*
      Two real bugs found by tests, both fixed: trailing silence was never detected because
      ffmpeg reports a `silence_end` at EOF, and the fade-out was ramping *up* (wrong mirror gain).
      Environment bug: installed edge-tts 7.2.8 gets HTTP 403 from Microsoft's endpoint; the pinned
      7.3.1 works. FastAPI/pydantic/uvicorn are also older than `requirements.txt` pins — noted,
      not upgraded mid-task. Added a minimal `[tool.ruff]` config and pinned `ruff==0.17.2` in
      `requirements-dev.txt` (AGENTS requires ruff-clean, but there was no config and no ruff
      installed); `ruff check app tests` now passes.
- [x] 2026-10-26 - narration plan glue: `packages/core/src/plan.ts`
      (`buildNarrationPlan` → `planToSegments`). The ordering is the point and it is now locked by
      tests: parse overrides → expand numbers → segment → transliterate → assign voices. Numbers
      must expand *before* segmentation or the digits are already gone; overrides must parse
      *before* numbers or `[[en:₹500]]` inside a Tamil sentence is read as Tamil.
      `expandNumbersSpanned()` moves forced spans by the exact length each expansion added.
      17 plan tests + 2 new number tests.
      Three real bugs found by the tests:
      (1) a merged Tamil+Tanglish run is labelled `tamil`, so `transliterateRuns` skipped it and
      sent Latin letters to the Tamil voice — it now rewrites every run that is not pure Latin;
      (2) `[[en:]]` (well-formed marker, empty body) was deleted outright instead of left as text;
      (3) number language used the nearest preceding word, so one English loanword
      (`எங்கள் business ₹1,20,000 லாபம்`) flipped a Tamil clause's number into English — it is now
      decided by the majority language of the clause.
- [x] 2026-10-26 - `npm run sample:tts` (`scripts/sample-tts.ts`) → six clips in `samples/tts/`.
      Starts uvicorn itself, resolves the pair from `GET /voices/{id}` (nothing hardcoded), builds a
      plan per clip, POSTs `/synthesize`, copies `master.mp3`, writes `report.json` + a listening
      checklist `README.md`. Added `GET /voices` + `GET /voices/{id}` to the media service (they
      existed as pure functions but were not routed).
      gate: pytest 91 passed / 3 skipped, ruff clean.
      Six clips: 10.34 / 9.50 / 16.31 / 7.33 / 4.03 / 16.04 s; 1 / 1 / 5 / 5 / 2 / 4 runs.
      **Loudness was wrong and the sample caught it.** Per-run two-pass `loudnorm` is peak-bound:
      edge-tts output is already near full scale, so every run landed at exactly −1.50 dBTP and the
      short ones at −18.9 LUFS. Measured masters: −16.35…−17.62 LUFS, i.e. outside the −16 ±1 LU
      contract, and 1.27 LU of spread between clips. Fixed with a program stage
      (`master_program`): measure the assembled master, apply the difference to −16 LUFS as plain
      `volume`, and when that would break −1.5 dBTP run `alimiter` first. `alimiter` shifts audio by
      its 5 ms lookahead (measured 3/47/95/239/479 samples for attack 0.1/1/2/5/10 ms) — only
      `latency=true` compensates it, and that variant is frame- and position-exact, which was
      verified with a single-sample impulse before it was allowed in. A final plain-gain trim closes
      inter-sample overshoot the sample-domain limiter cannot see, and the stage refuses to write a
      file whose frame count moved.
      After: all six at −16.28…−16.46 LUFS (0.18 LU spread), true peak −1.79…−1.86 dBTP, gains
      +0.08…+1.36 dB, durations unchanged, and every `master.wav` frame count exactly
      `total_duration_ms × 48`. `timeline.json` now records the master stage.
- [x] 2026-10-26 - synthesis cache: `services/media/app/cache.py` (`SynthesisCache` +
      `CachingTTSEngine`, wired in `create_app`, `GET /cache`, `TTS_CACHE*` env).
      Key is `sha256({v, engine, voice, text})` over the text *after* transliteration and number
      expansion — so a lexicon fix invalidates exactly the runs it changes, and a fix that leaves the
      text identical correctly stays a hit. Stores raw provider audio + words **before** trimming, so
      stitch and master-stage changes never invalidate an entry. Two files per entry, audio first and
      metadata last, each through a unique temp file + atomic rename; a corrupt or half entry is
      deleted and treated as a miss; an unwritable cache never fails the request. Bounded by
      `TTS_CACHE_MAX_MB`, oldest first.
      13 new tests (94 collected: 91 passed, 3 live skipped), ruff clean.
      Observed with the real edge engine, one 46-character run: cold 2.15 s → warm 0.48 s, identical
      duration (2966 ms) and identical word list; the remaining 0.48 s is ffmpeg, not the network.
      Surprise: no serialisation layer was needed — `WordTiming` round-trips through plain JSON — but
      the pydantic re-validation is what stops a hand-edited entry reaching the stitcher as garbage.
      Note: because the cache wraps the engine, `/health.engine` unwraps the decorator so the existing
      contract (`FakeEngine`, `EdgeTTSEngine`) still holds.
- [x] `sample:tts` 6 clips
- [ ] **listening gate approved** ← phase cannot close without this

## P2 … P11

Tracked in [docs/09-roadmap.md](./09-roadmap.md). Copy items here as they are started so this
file stays the single "what is actually true today" view.

---

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-26 | Keep `@stickman/*` code, rename scope in P0 | it is real prior work (segmenter + edge-tts + fonts), not scaffolding |
| 2026-10-26 | pg-boss over Redis/BullMQ | ledger + job state must commit in one transaction |
| 2026-10-26 | Raw ffmpeg + ASS before Remotion | deterministic output, 4K without Node memory, ASS gives per-word karaoke |
| 2026-10-26 | TTS before any visual work | it is the differentiator and the riskiest quality problem |
| 2026-10-26 | Cloudflare Workers AI as default free engine | user has it; covers planner + images + VLM with one credential |
| 2026-10-26 | No LoRA in v1 | style locking by description + palette + character bible is enough to test the product; LoRA needs GPU and is a P10 upgrade |
| 2026-10-26 | Webhooks signed by default | parity requires unsigned, security requires signed — signed default, opt-out for parity |
| 2026-10-26 | Timestamps normalised on the drizzle column, not by `pg`'s parser | drizzle bypasses `pg`'s type parsers, so a global parser is dead code; a column-level `customType` is the only place it actually runs |
| 2026-10-26 | Plans are code, not a table | docs/03 has no plan table and there are no prices to copy; `workspace.plan_id` is a pointer, so a plan change is not a migration |
| 2026-10-26 | One commit per step, network work outside it | artifacts + ledger + cursor + next job must be one transaction; a transaction held open during TTS/image calls would pin a connection and row locks for minutes |
| 2026-10-26 | `attempt` is a fence, not a retry count | it only has to distinguish holders of one lock; resetting on release keeps a retryable failure's retry immediate instead of waiting out the TTL |
| 2026-10-26 | Unknown step errors are permanent | a blind retry of a validation bug burns provider quota; adapters must mark transient failures `retryable: true` explicitly |
| 2026-10-27 | `ping` is a queue, not a `video.step` | the step tuple is a public contract; a smoke test must not widen it, and a worker with no step handlers must not look like it handles steps |
| 2026-10-27 | `queue:"ok"` means the expected queue rows exist, not that a connection opened | the failure that matters is a worker/schema that never created them, which a TCP check cannot see |
| 2026-10-27 | `/health` reports only components that exist | `media`/`storage` join the shape when their ports land; reporting them `ok` now would be a lie |
| 2026-10-27 | One `test` command, no `test:unit`/`test:contract` split | a split earns its keep when the halves need different isolation; a script CI forgets to run is worse than one always-run suite |
| 2026-10-27 | Lint without type-aware rules | boundaries and `no-explicit-any` do not need the type graph; `tsc` already owns types, and `gate` stays seconds long |
| 2026-10-27 | `FONTCONFIG_FILE` stays commented out | the referenced `fonts.conf` does not exist until P4; pointing libass at a missing file would break fonts earlier than the glyph test can catch it |
| 2026-10-27 | CI pins Python 3.12 while dev runs 3.14 | plan.md declares 3.12 as the runtime; CI should test the promise, not the machine, and 3.14 is the local convenience |
| 2026-10-27 | CI matrix is node 22 only | 22 is the `engines` floor; a second entry doubles minutes for a runtime no `engines` field claims to support |
| 2026-10-27 | `test:db` stays out of CI until it brings its own Postgres | a job that green-lights when the service is absent is worse than no job |
