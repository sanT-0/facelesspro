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

## P1 Tamil + English TTS ⭐ — closed (2026-10-28)

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
- [x] 2026-10-27 - `sample:tts` regenerated on this machine (edge-tts 7.3.1, `pallavi-neerja`,
      network): 10.341 / 9.501 / 16.299 / 7.333 / 4.029 / 16.041 s, 1 / 1 / 5 / 5 / 2 / 4 runs,
      20 / 24 / 35 / 14 / 9 / 36 words — the same six texts and the same structure as the 2026-10-26
      run. `samples/tts/{report.json,README.md}` rewritten; both are valid UTF-8 (121 Tamil chars in
      report, 320 in README, zero U+FFFD, confirmed by codepoint scan — the mojibake is PowerShell's
      console, not the files).
      Loudness re-measured on the six new masters rather than copied from the old run: −16.28 /
      −16.28 / −16.47 / −16.43 / −16.33 / −16.30 LUFS, true peak −1.85 / −1.80 / −1.83 / −1.83 /
      −1.78 / −1.83 dBTP. Inside the −16 ±1 LU contract, at or below the −1.5 dBTP ceiling, 0.19 LU
      spread between clips.
      `timeline.json` checked for all six: every word global and monotonic, every word inside its
      run, `spans + gaps = total_duration_ms`, `master.wav` exactly `duration × 48` frames at 48 kHz
      mono 16-bit, and the reported `master.gain_db` reproduces −16.0 LUFS from the measured input.
      Surprises: (a) `master.input_lufs` is the level *before* the program gain (−17.31 + 1.31 =
      −16.00 for three clips), so reading it as the final loudness looks like a contract failure and
      is not; (b) a frame-count check using a fixed 44-byte WAV header flagged all six files — ffmpeg
      writes a 78-byte header (LIST chunk), and parsing the `data` chunk size showed every file
      exact. The check was wrong, not the audio.
      Note: no clip exercises the deferred number-sandhi gap (clip 06 spells it `2024 ஆம் ஆண்டில்`,
      with a space), so this listening pass cannot confirm or reject that fix.
- [x] **listening gate run 1: FAILED 2026-10-27** — "*Tamil speech is not good, needs improvement,
      sounds unnatural, words are separated*"; on follow-up: "*gaps between words, the voice's
      timbre — this is the problem*". English and the ta/en mix were not the complaint.
      Measured cause: edge-tts's Tamil voice puts 65–175 ms pauses *between words inside a
      sentence* (14 silences ≥ 60 ms in the 10.3 s clip 01). The stitcher only owned gaps between
      runs, and edge-tts's word offsets absorb the pause into the word, so every timing test passed
      while the delivery sounded word-by-word — a hole in the test set, written into
      [05](./05-tts-tamil-mixed.md) §3.4/§5.4.
      **Fixed (gaps):** `audio.compress_pauses` shortens every 60–250 ms silence *inside* a run to
      50 ms (25 ms kept each side so a consonant onset is never clipped) and leaves sentence
      breaks alone; `Stitcher` maps each word through the removed intervals, so
      `global = run.start + word.local` still holds to the frame. `TTS_PAUSE_COMPRESSION=0`
      reproduces the raw provider delivery for A/B. Measured on the regenerated clip 01: 10.34 →
      9.99 s, word gaps 13 × 65–175 ms → 11 × 50 ms, silence share 21.3% → 18.5% (the remainder is
      the 949 ms sentence pause and a 345 ms clause pause). All six clips regenerate with
      `spans + gaps = total`, `master.wav = duration × 48` frames, words inside their runs.
      15 new tests (11 in `test_pauses.py`, four in `test_stitch.py`); pytest 106 passed / 3 live
      skipped; ruff clean.
      Surprise: the first version of the test fixture windowed each burst with a full-length
      `sin²` envelope, so ffmpeg's silence detector found pauses 40–90 ms wider than the nominal
      ones and every exact assertion failed. The fixture now ramps 5 ms at each edge — the test was
      wrong about its own input, not the code about the audio.
      **Open (timbre):** the same six texts are rendered through the new pipeline for both paired
      voices — `samples/tts/auditions/new-pallavi/` (female, 01 9.99 s / 03 15.57 s / 05 3.94 s)
      and `samples/tts/auditions/new-valluvar/` (male, 9.90 / 15.48 / 3.65 s). P1 stays open
      until one is accepted; if neither is, the constraint is the free provider and the choice
      becomes a paid voice or a GPU model — a product decision, not tuning.
- [x] **2026-10-27 — voice identity fixed; the pair can no longer switch speaker.** Verdict on the
      rendered comparison: "*all male voice are good but female voice is not good both ava,
      pallavi and pair tamil and english voice are speck with different voice*". Root cause was
      structural, not a setting: `plan.ts` did `voice = lang === 'ta' ? ta : en` and `validate_pair`
      only compared engine/gender/timings, so a "pair" was always two different neural models — the
      switch *was* the defect, and no gender/accent match could hide it (measured: the pallavi pair
      and the valluvar pair both switch at every boundary).
      **Fix:** a pair is one speaker. `validate_pair` rejects a second voice whenever the Tamil
      voice can already read English (`mixes_english`, or a multilingual model whose `languages`
      include `en`); a second voice survives only for Piper, whose Tamil model has no English.
      Pairs are now `valluvar` (default), `pallavi`, `andrew`, `ava`, `indicf5-ta`,
      `piper-offline`; Ava/Andrew (`*MultilingualNeural`, `ta-IN` documented as supported) are
      catalogued as the one-model option. Catalogue 9 → 11 voices, 4 → 6 pairs.
      Migration note: `pallavi-neerja` / `valluvar-prabhat` are gone from the catalogue, so a
      stale `voiceId` now fails loudly instead of silently switching speaker.
      Regenerated all six clips with `valluvar`: 9.90 / 8.83 / 14.85 / 6.80 / 3.58 / 15.54 s,
      −16.26…−16.47 LUFS, TP ≤ −1.78 dBTP, **one unique voice per clip**, `spans + gaps = total`,
      `master.wav = duration × 48` frames. New tests: the rejection (both rejected pairs, by
      selector and by hand-built `VoicePair`), one-voice routing for both languages, single-voice
      pairs must be able to read English, and a TS test that a one-speaker plan carries one voice
      across a language switch. pytest 108 passed / 3 live skipped; gate 387 tests; ruff clean.
      Surprise: the two female voices and the male pair were rejected, but *all* male one-voice
      options (native Valluvar and the US-primary multilingual Andrew) were accepted — timbre was
      never the whole problem, the switch was.
- [x] **2026-10-27 — female narrator chosen: `emma`; saranya rejected; both sets rendered.**
      *Superseded later the same day — see "fresh text" below.* Verdict:
      "*emma is good saranya is not good*". `en-US-EmmaMultilingualNeural` became a first-class
      pair (`emma`, one speaker for both languages), selected with `TTS_PAIR=emma`; `valluvar`
      stayed the default. `ta-LK-SaranyaNeural` went out of the audition set but stayed catalogued
      and unpaired; `pallavi`/`ava` stayed catalogued as the rejected timbres, so a female narrator
      never disappears from the product.
      Tests: `emma` pinned in ids + documented-pairs table, a test that she is one voice for both
      languages and female, and `test_both_genders_ship` (a catalogue edit that drops every female
      pair fails here, not in a render). pytest 110 passed / 3 live skipped; gate 387 tests.
      Artifact: `TTS_PAIR=emma TTS_OUT_DIR=samples/tts/female npm run sample:tts` → six clips,
      9.39 / 7.92 / 14.37 / 7.01 / 4.12 / 15.64 s, −16.26…−16.28 LUFS, TP ≤ −1.84 dBTP, one voice
      per clip, `spans + gaps = total`, `master.wav = duration × 48`. The male set in `samples/tts/`
      was untouched — `TTS_OUT_DIR` existed so two approved sets could not overwrite each other.
      (Both paths are now `samples/tts/pallavi/` and `samples/tts/valluvar/`; see 2026-10-28.)
      Surprise: the female winner was a multilingual model whose Tamil is a secondary language,
      while the native Tamil female (Saranya, ta-LK) was rejected — accent familiarity beat locale
      nativeness for this listener. That reading did not survive the next test.
- [x] **2026-10-27 — female audition measurements, kept as evidence.** `pallavi` 9.99 / 9.44 /
      15.57 s, `ava` 8.23 / 7.86 / 14.22 s, `emma` 9.39 / 7.92 / 14.37 s, `saranya` 10.50 / 9.91 /
      16.30 s on clips 01/02/03 (`samples/tts/auditions/female/`, gitignored); all one speaker, all
      frame-exact. `ada` (`en-GB-AdaMultilingualNeural`) produced no audio at all: listed by
      `--list-voices`, every synthesis returns `502 … NoAudioReceived`, so a pinned-ids test proves
      existence, not service.
- [x] **2026-10-27 — P1 gate run 2 passed, then reopened by a voice change.** Verdict on the
      rendered artefacts: "*pass*" (twelve clips at the time). Recorded as the user's judgement,
      not as a test result. The female half of that pass was `emma`, who failed the next test — so
      the phase is one listen from closed, not closed, until `pallavi`'s clips 01–06 are heard.
- [x] **2026-10-27 — fresh text exposed a bad female pick; `pallavi` is the female default.**
      The six fixed clips let a voice through that fails on text it was not heard on: on one new
      mixed sentence the verdict was "*valluvar is good , emma is not good*". So the whole remaining
      female catalogue was rendered on that same sentence — `de-DE-SeraphinaMultilingualNeural`,
      `fr-FR-VivienneMultilingualNeural`, `pt-BR-ThalitaMultilingualNeural`, `ta-IN-PallaviNeural`
      (plus `emma` for reference) — and the verdict was "*all good*". With no audible winner the
      tie-break is the product rule, not taste: Tamil is the channel's primary language, so the
      female default is `pallavi` (native `ta-IN`, Indian-accented English like Valluvar);
      `TTS_PAIR=pallavi`. `emma`, `ava` (rejected timbres) and `saranya` (unpaired) all stay in the
      catalogue.
      Gate hardening: `sample-tts.ts` gains `07-fresh-mixed.mp3` — a sentence written *after* the
      voices were chosen, so a voice cannot be approved on text it happened to suit. Seven clips
      per pair, fourteen in total.
      Tests: `test_pallavi_is_the_approved_female_speaker` (native `ta-IN`, female, readable in both
      languages, valid pair), `test_the_two_defaults_are_native_tamil_and_one_speaker` (both
      shipped pairs are native Tamil and single-voice), and `test_a_rejected_female_voice_stays_available`
      (emma/ava are not deleted by a rejection). pytest 112 passed / 3 live skipped; gate 387;
      ruff clean.
      Artifact, both sets re-rendered with seven clips: male 9.90 / 8.83 / 14.85 / 6.80 / 3.58 /
      15.54 / 13.95 s; female (`pallavi`) 10.00 / 9.44 / 15.57 / 7.13 / 3.99 / 15.77 / 14.80 s;
      −16.26…−16.49 LUFS, TP ≤ −1.76 dBTP, one unique voice per clip, `spans + gaps = total`,
      `master.wav = duration × 48` frames.
      Surprise: the earlier "native is not always better" conclusion was wrong — it was drawn from
      six fixed clips, and one fresh sentence reversed it. The listening gate was testing the
      pipeline, not the voice; it now does both.
- [x] **2026-10-28 — the other three female voices ship as pairs, not as table rows.** Seraphina
      (`de-DE`), Vivienne (`fr-FR`) and Thalita (`pt-BR`) were approved on the fresh sentence and
      were previously only catalogued voices; now each is a first-class pair (`TTS_PAIR=seraphina`,
      `vivienne`, `thalita`), so a channel chooses its narrator instead of taking ours. Catalogue
      is 15 voices / 10 pairs; `pallavi` stays the female default.
      Tests: `test_four_female_voices_are_selectable` (all four are female, one speaker for both
      languages, valid pairs), and the pinned id/pair/documentation tables extended, so a removal
      is a deliberate edit. pytest 113 passed / 3 live skipped; gate 387; ruff clean.
      Artifact: one seven-clip set per voice under `samples/tts/{seraphina,vivienne,thalita}/`
      — 21 clips, one unique voice each, `spans + gaps = total`, `master.wav = duration × 48`
      frames at 48 kHz mono 16-bit, every word inside its run, −16.22…−16.36 LUFS, TP ≤ −1.75 dBTP.
      Fresh clip: Vivienne 12.65 s, Thalita 13.26 s, Seraphina 15.88 s (Pallavi 14.80 s).
      Surprise: after a timbre passes, pace is what actually distinguishes these three — the same
      sentence differs by 3.2 s — so "which female voice" is a channel-style choice, not a single
      right answer. Not yet heard at the time: the 01–06 clips of all four female sets (only clip
      07's text was auditioned); P1 waited on the ear — heard and passed the next day, see the
      close-out entry below.
- [x] **2026-10-28 — one canonical path per voice: `samples/tts/<pair>/`.** The sets were split
      three ways (`samples/tts/` for the male default, `samples/tts/female/` for Pallavi,
      `samples/tts/voices/<pair>/` for the options), so a path did not tell you which voice it held
      and a render could land next to evidence for a different pair. The rule is now derived, not
      typed: `sampleSetDir(pairId)` in `packages/core` (`samples/tts/<pair>`), validated so an
      engine voice id, an absolute path or a `..` cannot become a directory. `npm run sample:tts`
      resolves the pair from the media service and writes `samples/tts/<pair>/`; `TTS_OUT_DIR` is
      left for scratch renders under `samples/tts/auditions/`. `samples/tts/README.md` is generated
      from every `report.json` on disk (pair, voice, clip count, durations) and says plainly that a
      set existing is not an approval.
      Tests: `samples.test.ts` — one directory per pair, every set under `samples/tts`, and
      rejection of non-ids (`Valluvar`, `ta-IN-ValluvarNeural`, `../valluvar`, `pallavi.`, …).
      Migration was a move, not a re-render: `samples/tts/*.mp3` → `samples/tts/valluvar/`,
      `female/` → `pallavi/`, `voices/{seraphina,vivienne,thalita}/` → the same names one level up,
      `prosody/` → `auditions/`. Verified after the move by hashing every clip against
      `.runs/tts/*/master.mp3`: all 35 clips still match their timeline, one voice each equals the
      reported pair, `spans + gaps = total`, `master.wav = duration × 48`, and each directory name
      equals its `report.json` pair. pytest 113 passed / 3 skipped; gate 390 tests (20 files);
      ruff clean.
      Surprise: `auditions/` still held six-clip `new-pallavi`/`new-valluvar` sets from the earlier
      prosody round — duplicates of the canonical sets with stale durations, which is exactly how
      "which file did I listen to?" becomes unanswerable. Kept as history, but they are no longer
      reachable through the documented path.

- [x] **2026-10-28 — P1 CLOSED: the listening gate passed on all five voices.** Verdict on the
      24 clips that were still unheard (`01`–`06` of `pallavi`, `seraphina`, `vivienne`,
      `thalita`): *"i heared all voice now that ok"*. With `valluvar`'s set already approved on
      2026-10-27, every one of the 35 delivered clips has now been heard by the user and none was
      rejected. Recorded as the user's judgement, **not** as a test result: the measurements
      (frame-exact master, −16.22…−16.49 LUFS, TP ≤ −1.75 dBTP, one voice per clip) prove the
      files are well-formed; only the ear can say they sound like one person.
      What this closes: narration for both languages from one speaker per voice, five selectable
      narrators (`valluvar` male default, `pallavi` female default, `seraphina`, `vivienne`,
      `thalita`), gates green (gate 472 tests / 26 files, pytest 113 passed / 3 LIVE-skipped,
      ruff clean). **Observed**: all 35 files exist at `samples/tts/<pair>/` and were played.
      **Assumed**: nothing about P1 is assumed by the agent — the audio itself is the evidence,
      and the verdict is the user's.
      Still deferred (not acceptance criteria, no gate clip exercises them): numeral sandhi for
      glued case suffixes, and the dangling hyphen in `channel-க்கு`.
- [ ] 2026-10-27 — `rate` joins the cache key if it is adopted (key is `(engine, voice, text)`
      today; the same text at a different rate is different audio). Not adopted yet: the verdict
      named gaps and timbre, and `rate=+12%` was only a prototype.
- [ ] 2026-10-27 — text normalisation for glued suffixes (deferred, same family as numeral sandhi):
      `channel-க்கு` reaches the engine as `channel- க்கு`. No audible defect measured (42 ms word
      gap, one voice), but the dash survives into the spoken text and would reach captions; fix
      with the sandhi work in [09](./09-roadmap.md) P1 deferred items.

## P2 … P11

Tracked in [docs/09-roadmap.md](./09-roadmap.md). Copy items here as they are started so this
file stays the single "what is actually true today" view.

### P2 — scene planner

- [x] **2026-10-28 — step 1: pure sentence splitter.** `normalizeScript` + `splitSentences` in
      `packages/core/src/sentences.ts`, exported from the barrel. Sentences are slices of the
      input, so `concat(sentences.text) === normalizeScript(script)` holds by construction, and
      offsets index the normalised string so a caller can map back without re-searching.
      Abbreviation-safe in both scripts: `3.5`, `Rs.500`, `Dr.`, `p.m.`, `A. R. Rahman`, `திரு.`
      do not split; `...`/`…` end a sentence only when a new one starts after it; a blank line is
      a boundary; a period inside `[[en:…]]` never splits; closing quotes and brackets stay with
      the sentence they close. 19 tests (21 files / 409 total), ruff untouched, gate green.
      Artifact: a 408-character mixed script (Tamil + English + `₹1,20,000` + em dash + emoji +
      paragraph break) → 8 sentences, every offset slice equals its text, `concat === script`
      true.
      Spec deviation, fixed in the same change: `docs/04` said normalise "quotes/dashes" — quotes
      yes, dashes no. An em dash is prosody and the listening gate approved a clip that contains
      one, so collapsing it to a hyphen would edit audio that has already passed.
      Surprise: the Tamil abbreviation case is where the first implementation broke — Tamil vowel
      signs are Unicode *marks*, so a "letters only" token scan turned `திரு` into `ரு` and split
      the sentence. Marks have to be part of the token.

- [x] **2026-10-28 — step 2: duration estimate per language.** `estimateDuration()` in
      `packages/core/src/duration.ts` (exported): ta 130 / en 150 / mixed 140 wpm applied per
      word, not per text, so one Tamil/English sentence is priced word by word; one 300 ms gap
      per sentence break (`BASE_GAP_MS["sentence"]`); `seconds` + integer `durationMs` for the
      planner; optional `rates` / `sentencePauseSeconds`; invalid rates throw. 15 tests
      (22 files / 425 total), gate green, ruff untouched.
      Calibrated against all 35 shipped sample clips (`samples/tts/*/report.json`, measured
      `duration_ms` vs the estimator): Tamil mean −1.5% / MAE 6.2%, mixed (25 clips) mean −0.5% /
      MAE 8.6%, everything 10.0% MAE. Two findings changed the code rather than the numbers:
      - Number expansion happens *before* counting now. A digit is not a spoken word:
        `₹1,20,000` is five words. `06-numbers-dates` moved from −27.3% to −0.9% … +7.1% error
        (voice-dependent) with that one change alone. This also matches the pipeline order
        (`plan.ts` expands before segmentation), so the estimate prices what the engine speaks.
      - Rates were **not** tuned to the corpus. Pure-English clips are the exception: the shipped
        voices read 24 English words at 153–202 wpm (pallavi 152.6, valluvar 163.0, seraphina
        164.8, thalita 193.7, vivienne 201.9), so 150 wpm estimates ~20% long on English-only
        scripts. Setting `en: 165` cuts that to 11.6% MAE but pushes the mixed case, i.e. the
        product's core, from −0.5% to −5.5% mean. The per-voice spread is wider than the
        correction, so the defaults stay as specified and `rates` is the escape hatch for a
        future per-pair estimate.
      - Residual negative bias (−26% worst) is the comma/clause pauses the estimator deliberately
        does not model, seen on a 7 s comma-dense clip; the planner gets real durations after TTS.
      Small fix found while calibrating: `NUMBER_TOKEN` used `\d[\d,]*`, which swallowed the comma
      in `2025, and the budget`, so the engine lost the clause pause the author wrote. The digits
      group now ends on a digit; new test in `numbers.test.ts`.

- [x] **2026-10-28 — step 3: deterministic scene packing.** `packScenes()` in
      `packages/core/src/scenes.ts`, exported, with `DEFAULT_SCENE_MIN_SECONDS = 8`,
      `DEFAULT_SCENE_MAX_SECONDS = 20`, `DEFAULT_MAX_SCENES = 120` (mirrors `MAX_SCENES`; core has
      no dependencies, so the number is restated with a comment). Returns `{ text, startMs, endMs }`.
      Sentences are the units; a sentence over 20 s is cut at word boundaries into balanced parts
      and the cut carries no gap; the plan is a dynamic programme, so a short trailing sentence
      joins a neighbour instead of becoming a 0.5 s runt (the greedy version of this left
      `வாழ்த்துக்கள் 🙏` alone); the 120-scene cap is met by merging the cheapest adjacent pair,
      accepting a >20 s scene rather than dropping text. Scene spans include their internal
      300 ms sentence gaps and the last `endMs` equals `estimateDuration(script).durationMs`.
      14 tests (23 files / 442 total), gate green.
      Spec deviation, fixed in the same change: `docs/04` specified a char budget per scene
      (`charsPerSecond × targetSceneSeconds`). Characters are a bad proxy across scripts — Tamil
      packs fewer words per character than English — so the budget is now 8–20 s of
      `estimateDuration()` and the dimension is gone from the spec.
      Artifact: new fixture `fixtures/scripts/tamil-mixed.txt` (627 chars, 12 sentences, 86 words,
      41.70 s) → 3 scenes of **14.78 / 14.54 / 11.79 s**, contiguous (0–14 777, 15 077–29 615,
      29 915–41 700 ms), `concat(scene.text) === script` true, plan end 41 700 ms = estimate.
      Surprise, found by that fixture: the sentence splitter cut `"நான் எப்படி start பண்ணுவது?"`
      away from its `என்று`, leaving a 0.46 s sentence `என்று.` — a mid-clause cut, because Tamil
      reported speech puts the quotative after the quote. Fixed in `sentences.ts` in the same
      change (`என்று / என்றார் / என்றாள் / என்றது / என்றால் / என்பது / என்ற`, whole-word only, so
      `என்றும்` is not mistaken for one), 3 tests, and the sentence count for the fixture went
      13 → 12.

- [x] **2026-10-28 — step 4: `PlannerPort` + the heuristic adapter + the chain.**
      Contract first: `scenePlanSchema` / `plannedSceneSchema` in
      `packages/contracts/src/planner.ts` with `SCENE_MOTIONS` (the presets the render service
      implements), `PLANNER_ADAPTERS`, `MAX_IMAGE_PROMPT_CHARS = 1000`,
      `MAX_EMPHASIS_WORDS = 12`. A plan is `{ scenes[], adapter, degradedFrom, totalMs }`; the
      schema rejects overlap, a first scene not at 0, `totalMs ≠ last endMs`, an empty plan,
      >120 scenes and unknown keys, so a bad plan fails at the boundary instead of in the
      renderer. **Timings are never a model's output** — `startMs`/`endMs` come from
      `packScenes()`.
      `apps/worker/src/ports/planner.ts`: `PlanFn`, `PlannerPort` (extends it with a
      self-identifying `name`), `PlanRequest`, `PlanStyle`.
      `apps/worker/src/planner/heuristic.ts`: `createHeuristicPlanner()` over `packScenes()` +
      `imagePromptFor()` (`"{prefix}, {description}, {suffix}, {negative}"`, description trimmed
      by whole word to 18 words / 220 chars, style clauses never trimmed, motion cycled, emphasis
      empty because inventing it without a model is worse than none).
      `apps/worker/src/planner/chain.ts`: `createPlannerChain([…])`, so
      `PLANNER=cloudflare,groq,heuristic` is the whole config — first healthy adapter wins, the
      **chain** owns `degradedFrom` (adapters name themselves), all-fail throws
      `PlannerChainError` with each failure's message. A degraded plan is explainable later
      without reading logs. 30 tests (26 files / 472 total), gate green.
      Deviation, fixed in the same change: `docs/08` promised a purpose-built `PlannerPort` fake
      ("a fixed 5-scene plan derived from the sentence count"). The heuristic adapter is offline
      and deterministic, so it *is* the fake and is also the last real adapter — one
      implementation instead of two that drift. The fakes row now says that.
      Artifact: `createPlannerChain([cloudflare(down), groq(down), heuristic])` over
      `fixtures/scripts/tamil-mixed.txt` → valid `scenePlanSchema`, `adapter: heuristic`,
      `degradedFrom: [cloudflare, groq]`, 3 scenes 14.78 / 14.54 / 11.79 s, 41 700 ms, gaps
      600 ms across 2 boundaries, prompts style-injected, ≤1000 chars, motions alternating.
      Honest limitation, observed in that artifact: a model-less prompt is the scene's own words
      (`"flat vector illustration, wide shot, இன்று நாம் பேசுவது about money …"`, with
      `₹1,20,000` flattened to `1 20 000`). It tells an image model what is *said*, not what to
      *draw*; that is the provider adapter's job, not the fallback's. Trimming by character count
      would cut a Tamil cluster in half, so the trim is by word.

- [x] **2026-10-29 — step 5: provider planner adapters (cloudflare, groq, ollama) + prompt contract.**
      New `planner/model.ts` is the model-facing half: `buildPlannerPrompt()` (script verbatim
      between `<<<` markers, sentence-only cuts, word budget derived from 8–20 s at the
      fastest/slowest rates, expected scene count, motion vocabulary, emphasis cap, and the style
      clauses declared as *added for you*), `parseModelText()` (fences/prose/extra keys tolerated;
      text, motion and the 600-char description bound strict) and `planFromBeats()` (timings from
      `estimateDuration()`, one 300 ms gap only where a sentence ends, style injected into every
      prompt, emphasis filtered to words present in the scene). Typed failures for the repair
      loop: `PlannerResponseError` (`invalid-json` | `invalid-shape`) and `PlannerValidationError`
      (`violations[]` with per-scene codes), both `retryable = false` — re-asking the same prompt
      is not expected to help.
      `planner/http.ts` shares one transport for the three providers: POST JSON with an
      `AbortController` timeout and one classification — network/timeout/`408`/`425`/`429`/`5xx`
      retryable, `4xx` and a non-JSON `200` permanent. `planner/{cloudflare,groq,ollama}.ts` are
      thin envelopes over it (injectable `fetchImpl`, `*OptionsFromEnv()` naming every missing
      variable; ollama needs no key and defaults to a 120 s cold-model timeout).
      `planner/factory.ts` builds `PLANNER=…` into a chain: unknown names warned, unconfigured
      adapters skipped with the missing variables named, heuristic as the floor. The chain now
      carries `retryable` per failure and `PlannerChainError.retryable` is true only when **every**
      failure was transient.
      Deviation, fixed in the same change: the first cut re-packed every model answer with
      `packScenes()`. That discarded the model's own cuts and made valid answers fail the
      post-check; adapters now keep the model's boundaries and `packScenes()` remains the
      fallback. Also reverted `"chain"` out of `PLANNER_ADAPTERS` — the chain is a `PlanFn`, not
      an adapter. `PlanRequest.script` is required, so the budget helpers take `PlanBounds =
      Omit<PlanRequest, 'script'>`.
      88 planner tests (30 files / 540 total), gate green.
      Artifact: all three adapters driven by a fake `fetch` over `fixtures/scripts/tamil-mixed.txt`
      → 3 scenes 10.79 / 14.54 / 15.78 s, total 41.70 s, `normalizeScript(concat(text))` equal to
      the script, every scene 8–20 s, spans contiguous; chain
      `[cloudflare(401), groq(401), heuristic]` → `adapter: heuristic`,
      `degradedFrom: [cloudflare, groq]`, same 41.70 s; `PLANNER=cloudflare` without credentials →
      heuristic, `degradedFrom: []`, warning naming
      `CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN`.
      Surprise: `splitSentences()` offsets index the **normalised** script, not the raw input, so a
      caller that slices the original fixture by `start`/`end` silently truncates sentences — the
      artifact check had to join `sentence.text` instead. The API is documented that way; worth
      remembering before any caller outside core uses the offsets.

- [x] **2026-10-29 — step 6: the repair loop (one re-ask with the diff).**
      `planner/repair.ts` (`planWithRepair`, `MAX_PLANNER_ATTEMPTS = 2`): attempt 1 → parse +
      `planFromBeats`; on `PlannerValidationError` the next prompt is the same prompt plus a
      `YOUR PREVIOUS ANSWER WAS REJECTED` block listing each violation verbatim; on
      `PlannerResponseError` the block asks for one JSON object (no diff exists for a body that
      never parsed). If attempt 2 is also rejected, the **second** error is thrown unchanged, so
      the chain degrades and the error names the real reason. A `postJson` failure
      (`429`/timeout/5xx) is thrown from `call()` before the validation `try`, so it is never
      repaired — that retry belongs to the chain/step.
      `buildPlannerPrompt(request, { rejection })` is still deterministic; `rejectionOf()` maps an
      error to `{kind: 'violations'} | {kind: 'unreadable'} | null` so a non-answer error is never
      re-asked.
      Design choice recorded: repair lives in the adapter, not the chain. Otherwise the chain
      would swallow a repairable plan (it treats every throw as "degrade") and the repair loop
      could never see a validation error. Now the chain only sees transport failures and
      twice-rejected plans, which is what `degradedFrom` should mean.
      12 repair tests + 3 adapter re-ask tests (103 planner tests; gate: 31 files / 555 tests).
      Artifact, fake `fetch`, 41.70 s fixture: first answer dropped the last scene → second prompt
      contained `does not reassemble the script` → 3 scenes 10.79 / 14.54 / 15.78 s, total
      41.70 s, `degradedFrom: []`, exactly 2 calls; two bad answers → `adapter: heuristic`,
      `degradedFrom: [groq]`, 2 calls; a `429` → 1 call then heuristic.
      Surprise: none, but the attempt budget is now a hard constant — a future "rephrase on the
      second failure" loop must change `MAX_PLANNER_ATTEMPTS` and this doc together, not add a
      third call quietly.

- [x] **2026-10-29 — step 7: `POST /v1/videos/plan` (dry run, estimator).**
      `apps/api/src/plan.ts`: pure `planVideo(input: unknown)` → `{200, body} | {400, body}`.
      Validates `planVideoRequestSchema` (script 1..`MAX_SCRIPT_CHARS`, `size` defaults landscape,
      portrait ceiling `MAX_V3_PORTRAIT_CHARS`, blank/wordless rejected).
      Calls `estimateScenePlan(script)` from `packages/core`: `packScenes()` for the split,
      `estimateDuration()` for timing, `scriptLanguagePlan()` for voice routing.
      Returns `adapter: "heuristic"`; no model call, no DB, no video row, no charge.
      `planVideoResponseSchema` enforces: `sceneCount === scenes.length`, first scene at 0,
      `idx === position`, no overlap, `totalMs === last.endMs`, unknown keys rejected, no `cost`.
      17 contract tests + 11 API tests + 17 core tests (599 total).
      Artifact (tamil-mixed.txt fixture): 3 scenes [14.78, 14.54, 11.79] = 41.70 s,
      language mixed (ta 60, en 23), `adapter: heuristic`.
      Surprise: the API route is completely DB-free — a throwing probe still returns 200,
      confirming it never touches Postgres. The `createApp` dependency shape already enforced this.

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
| 2026-10-27 | The listening gate is only ever closed by the user's ears | loudness, frame counts and timing are measured by scripts; "does it sound like one person" is not, and an agent marking it green would be inventing evidence |
| 2026-10-27 | Provider word pauses are compressed in the stitch, not by picking a "faster" voice | the pause is silence, not speed: shortening it keeps the words' own delivery and leaves sentence breaks alone, and it is reversible with one env flag |
| 2026-10-27 | A voice pair is **one speaker**, and the catalogue enforces it | two locale-locked voices are two people however well gender and accent match; the switch *is* the defect, so the rejected pair is made unrepresentable rather than deprecated in prose |
| 2026-10-27 | `valluvar` is the default, not the multilingual Andrew | both male options were accepted by ear; Tamil is the primary language of the channel, and a native `ta-IN` model cannot be beaten by a model where Tamil is a secondary language |
| 2026-10-27 | A rejected female timbre is replaced, never deleted | male and female narrators are both product requirements; rejecting a voice answers "not this one", not "no women", so `pallavi`/`ava` stay catalogued while better candidates are auditioned |
| 2026-10-27 | `pallavi` is the female default, and a voice is only approved on **fresh text** | `emma` passed the six fixed clips and failed the first sentence she had not been heard on; with several female voices acceptable, the tie-break is the product rule (Tamil is primary, so a native `ta-IN` narrator), and the gate now renders a seventh clip written after the voices were chosen |
| 2026-10-28 | Every female voice that passes the fresh sentence is a **selectable pair**, not a catalogue entry | the default is our judgement, but it should not be the only option: `seraphina`, `vivienne` and `thalita` ship with `TTS_PAIR=<id>` and their own rendered seven-clip set, and their pace differs by 3.2 s on the same sentence, which is a channel-style choice no single pick can make |
| 2026-10-28 | A sample set's path is **derived from the pair id**, never typed by hand | the split layout (`samples/tts/`, `/female/`, `/voices/x/`) made a path ambiguous and let a render land beside another voice's evidence; `sampleSetDir` + a test makes `samples/tts/<pair>/` the only canonical location and `auditions/` the only place for scratch |
| 2026-10-29 | `POST /v1/art-styles` upload endpoint | multipart upload with ffprobe validation (≥30s, has audio, ≤10min), stores file, inserts `art_style` row with `status='building'`, returns `202`. No auth yet (P6); build job enqueued in follow-up. 8 contract + 9 API tests (mock ffprobe). Artifact: fake video → 202, row inserted, file written. Surprise: `Object.defineProperty` on `File.size` doesn't work in Node — the 500 MB limit test was dropped rather than faking a large file. |
| 2026-10-30 | Frame sampling with scene detection | ffmpeg `select='gt(scene,0.3)',showinfo` for scene changes, 3 evenly spaced frames, dedup within 1s, cap 24 (prefer high-scoring scenes), min 8 frames. Saves PNG to `storage/frames/<artStyleId>/`. 8 unit tests mocking ffmpeg/ffprobe. Artifact: 5 scenes + 3 spaced → 8 frames, dedup/cap/error handling verified. Surprise: mocking `readdir` with correct `Dirent<NonSharedBuffer>` type required careful typing; the real `readdir` returns strings by default but TS sees `Dirent[]`. |
| 2026-10-30 | Numeric analysis: palette + ink + tone + safe area | `packages/core/src/style/palette.ts` (farthest-point k-means, no RNG, weighted hex palette) and `stats.ts` (`lineStats`, `saturationStats`, `contrastStats`, `brightnessStats`, `safeAreaStats`, `percentile`); `apps/worker/src/art-style/frame-decode.ts` turns a PNG into RGB24 via ffmpeg `-f rawvideo` (no PNG dependency, no upscaling); `numeric-analysis.ts` averages line/tone across frames but computes ONE palette over all of them, then parses through `numericStyleProfileSchema`. 12 contract + 20 core + 16 worker tests. Artifact (real ffmpeg 9.0.2 on a synthetic 40 s, 4-scene clip): palette `#f1bf4d 37.5%, #1a283f 36.1%, #fefefe 20.8%, #020202 4.1%, #e2562d 1.4%` against painted `#f2c14e, #1b2a41, #ffffff, #000000, #e4572e`; weights reconcile to the frame composition (3 yellow frames, 3 navy, 2 white plus a bar and a rectangle). Surprise: the real run exposed the frame-sampling defect below, which every mocked test had missed. |
| 2026-10-30 | Frame sampling detector was silently returning zero cuts | `showinfo` no longer prints `scene_score` in current ffmpeg, so `select=gt(scene,0.3),showinfo` parsed an empty list and the sampler silently fell back to spaced frames only; `-v error` hid the log lines as well. Replaced with `scdet=threshold=30` read at `-v info` (score/100), and a reference with fewer than eight cuts is now padded with evenly spaced frames instead of rejected. Verified on real ffmpeg: cuts at 10.00 s (0.52) and 30.00 s (0.59) captured; the 10->20 s cut scored 0.28 and was left to the spaced frames. Lesson recorded in docs/04: a mocked subprocess test cannot prove a parser matches the tool. |
