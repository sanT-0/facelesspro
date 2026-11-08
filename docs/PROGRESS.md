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
- [x] 2026-11-05 — multi-product reference-research policy made durable in `AGENTS.md`,
      `plan.md`, `docs/02-reverse-engineering.md` §0 and `docs/11-legal-and-compliance.md` §1.
      FacelessPro's user requirements and specs remain authoritative; when behaviour or UX is
      unclear, future work checks the anonymised baseline plus public standards/docs and multiple
      relevant products where practical, records observed/inferred/unknown evidence, and produces
      an original design instead of treating one product as a blueprint. Public, lawful access
      only; no copied implementation/expression or access-control bypass. Docs-only task, so no
      invented failing unit test; structural artifact check `git diff --check` was clean and
      `npm run gate` passed **83 files / 1044 tests**. Python not run because no media/render code
      changed. **Observed:** the rule is present in all four durable instruction/spec locations.
      **Assumed:** future contributors follow it; product identities remain in external evidence
      notes under the existing de-anonymisation decision rather than being reintroduced here.
- [x] 2026-11-05 — local named-product index added at
      `docs/reference-products.local.md`, with the exact path ignored in `.gitignore` and an
      `AGENTS.md` instruction to read it when present. It contains the known baseline identity,
      an explicitly unverified and expandable candidate pool, research workflow, legal boundaries,
      and a dated evidence-note template; the file says plainly that navigation is not evidence.
      **Observed:** `git check-ignore -v` resolves the file to `.gitignore:8`, normal
      `git status --short` omits it, the file remains locally readable, `git diff --check` is clean,
      and `npm run gate` passed **83 files / 1044 tests**. Python not run because no media/render
      code changed. **Surprise/constraint:** an ignored file persists for agents in this workspace
      but cannot travel through Git to a fresh clone; it must be recreated there intentionally.
- [x] 2026-11-05 — consulting the local reference index is now mandatory before **every**
      product-reference task, not conditional. `AGENTS.md`, `plan.md`, `docs/02` §0,
      `docs/11` §1 and the ignored file itself all require reading
      `docs/reference-products.local.md` first, recreating it locally if absent, and updating it
      whenever a named source or starting URL is added, removed, or materially re-evaluated.
      The index remains navigation rather than evidence. **Observed:** a structural grep found the
      mandatory rule in all five locations, `git check-ignore -v` still resolves the file to
      `.gitignore:8`, `git diff --check` is clean, and `npm run gate` passed
      **83 files / 1044 tests**. Python not run because no media/render code changed.
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
- [x] 2026-11-02 — P0 close-out: first green CI runs on the remote, observed via the GitHub
      checks API on PRs #25/#26: `gate (node 22)` ✅, `python 3.12` ✅, CodeQL ✅. The
      2026-10-30 assumption above (ubuntu apt ffmpeg filter coverage) now has a green runner
      run behind it, observed result green, so the item closes.

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
- [x] 2026-11-02 — Python 3.12 runner pin observed for the first time: the `python 3.12` CI
      check on PR #26 ✅, closing the "not observed on the runner" note from 2026-10-31
      (all four pinned deps installed remotely, ruff/pytest green there).
- [ ] 2026-10-27 — `rate` joins the cache key if it is adopted (key is `(engine, voice, text)`
      today; the same text at a different rate is different audio). Not adopted yet: the verdict
      named gaps and timbre, and `rate=+12%` was only a prototype.
- [ ] 2026-10-27 — text normalisation for glued suffixes (deferred, same family as numeral sandhi):
      `channel-க்கு` reaches the engine as `channel- க்கு`. No audible defect measured (42 ms word
      gap, one voice), but the dash survives into the spoken text and would reach captions; fix
      with the sandhi work in [09](./09-roadmap.md) P1 deferred items.

## Repository and community

- [x] **2026-11-01 - AGPL-3.0 licence, and the repo framed for contributors.**
      `LICENSE` now carries the full AGPL-3.0 text; `README.md` gains CI/licence/Node badges,
      a corrected status table (P0/P1/P2 closed, P3 in progress, P4 next — the old table still
      said "Phase 0" and "CI pending a push") and a "what AGPL means in practice" section;
      `docs/11-legal-and-compliance.md` §0 records the decision, the consequences and the
      non-consequences.
      Chosen over MIT/Apache-2.0 because a copyleft network clause is the only thing that stops
      a hosted fork becoming a closed competitor; chosen over source-available because "open
      source" was the goal. Contributions use a **DCO sign-off** rather than a CLA: cheaper for
      contributors, with the recorded cost that contributions cannot be relicensed later
      without every author. PRs land by **squash-merge, maintainer presses merge**.
      The licence does **not** clear a launch: `edge-tts` (§2) is still a launch blocker for any
      public deployment, and the README now says so instead of implying otherwise.
      Gate: docs-only, `npm run gate` still green (934 tests / 69 files). Python untouched.
      **Observed:** GitHub already had the repo public and the CI workflow already runs on
      `pull_request` (run #25 green), and a full-history check found only `.env.example` ever
      committed and no token-shaped strings in the tree.
      **Assumed / not observed:** whether GitHub detects the licence in the sidebar, which only
      happens after the push; and the branch-protection rules that make contributor PRs safe are
      a repository setting (Task C), not a file in this commit.

- [x] **2026-11-01 - contributor contract: docs, templates, ownership, dependency hygiene.**
      `CONTRIBUTING.md` states the loop (one task, test first, gate, artifact, dated
      `PROGRESS` line), the rules that get a change rejected, the Tamil invariants, dev setup,
      and the DCO + squash-merge policy. `.github/PULL_REQUEST_TEMPLATE.md` turns that into a
      checklist with a pasted `npm run gate` result and an explicit **observed vs assumed**
      section, so "it compiles" cannot be presented as "it works". Issue forms for bugs and
      features, with blank issues disabled and pointers to the roadmap and the private security
      flow. `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (Advisories first,
      in/out of scope named), `.github/CODEOWNERS` (whole repo plus `.github/workflows/**` and
      `packages/contracts/**` always routed to the maintainer), `.github/dependabot.yml` (grouped
      weekly npm/pip, monthly Actions - `npm ci` fails on lockfile drift) and `.editorconfig`
      (LF, so new edits stop producing CRLF noise).
      Deliberately **not** done here: branch protection / required checks / merge policy are
      GitHub settings, not files (Task C); and no `.gitattributes` renormalisation, because it
      would rewrite every file in one commit for no functional gain.
      Gate: docs and config only; `npm run gate` unchanged at **934 tests / 69 files**.
      **Observed:** all files parse as intended (YAML forms, CODEOWNERS syntax), and the existing
      workflow already runs on `pull_request`, so the template and required checks will meet a
      real PR. **Not observed:** GitHub accepting the YAML forms — that is only visible once
      pushed and someone opens an issue.

- [x] **2026-11-01 - how a PR is verified, and the settings that enforce it.**
      `docs/12-maintaining.md`: the branch-protection table for `development` with the **exact**
      check names (`gate (node 22)`, `python 3.12` — a typo in the UI requires nothing and blocks
      nothing), merge policy (squash only, PR title becomes the commit subject, auto-delete head
      branches), the security toggles that the docs already depend on (**private vulnerability
      reporting must be on or `SECURITY.md` and the issue-form link 404**), the label list the
      tracker uses, and the ten-step verification order: one task → agreed → green CI → DCO →
      diff against the rules → Tamil invariants → re-run the gate locally → re-verify the
      artifact → read observed-vs-assumed → docs ticked.
      Note on approvals: **0 required for now**, raised to 1 with stale-approval dismissal once a
      second maintainer exists, because a 1-approval rule with one maintainer deadlocks my own
      PRs. Admin bypass stays on while bootstrapping for the same reason.
      Gate: docs only, `npm run gate` still **934 tests / 69 files**.
      **Observed:** the required check names come from the workflow that actually ran green
      (#25 on `pull_request`), not from guessing.
      **Observed settings audit and correction (public GitHub API, 2026-11-01):** the initial
      state was `main` default, `development` unprotected, no checks/conversation rule, every
      merge method allowed, private reporting off, no topics and six labels missing; community
      health was 28%. After the settings pass: `development` is default and protected; its active
      ruleset requires `gate (node 22)` + `python 3.12` in strict up-to-date mode, resolved
      conversations and squash-only PRs, with 0 approvals and code-owner review off while there
      is one maintainer. Private reporting and web-commit DCO are on, all project labels/topics
      exist, AGPL-3.0 is detected, and community health is 100%. CodeQL's first
      Actions/JavaScript/Python run is green.
      **Maintainer-observed in the authenticated UI, not independently public-API-readable:**
      Dependabot alerts/security updates, secret scanning/push protection, read-only Actions
      permissions and first-time-contributor approval are on.

- [x] **2026-11-01 - contributor PR rehearsal (Task D) completed end to end.**
      Branch `fix/maintaining-observed-facts` corrects the mistyped SHA for run #25 and replaces
      an inference from the authenticated protection endpoint with the public settings audit
      above. It also records the prerequisite discovered by that audit: change the default branch
      from `main` to `development` before opening the rehearsal PR, or GitHub continues to ignore
      the new licence and community files. The rehearsal also caught and fixes one contributor
      contract bug: docs/config-only PRs can now mark the test-first item N/A when they provide a
      reproducible factual/structural check, instead of inventing a unit test for prose. This
      intentionally small workflow/docs change is the payload for required checks and a
      maintainer squash-merge.
      **Observed final:** PR #5 targeted `development`, carried a completed observed-vs-assumed
      review body plus the `docs` label, and had four commits with matching DCO trailers. All nine
      latest-head checks were green, including required `gate (node 22)` / `python 3.12` and
      CodeQL for Actions/JavaScript/Python. GitHub reported it clean and up to date; the maintainer
      squash-merged it as the one-parent, GitHub-verified commit `9ed31fd`, whose message retains
      one `Signed-off-by` trailer. Auto-delete removed `fix/maintaining-observed-facts` (API and
      `git ls-remote` both absent). Post-merge CI run #48 and CodeQL run #4 both completed green
      on `9ed31fd`. Required checks, squash-only merge, DCO preservation, branch cleanup and the
      post-merge gate are therefore observed rather than assumed.
      **Surprising:** the first ruleset save silently left code-owner review on, conversation
      resolution and required checks off, and strict up-to-date mode off. Reading the ruleset API
      after every save caught all four before merge. The first PR-body edit only toggled boxes and
      left placeholders; the final review record was re-pasted and verified through the API.

- [x] **2026-11-01 - Task E: four good-first-issue seeds created (issues #13–#16).**
      Genuinely bounded slices carved out of the documented-but-unimplemented work, none of them
      the P4 caption cue builder (reserved for the next maintainer task):
      **#13** run the 14 real Postgres/pg-boss integration tests in a CI service-container job
      (`good first issue`/`help wanted`/`pipeline`); **#14** add three original built-in caption
      template seeds as ids `-4`/`-5`/`-6` with an idempotency artifact check; **#15** mount
      `GET /v1/caption-templates` built-ins-only pre-auth (blocked by #14,
      `contract` label); **#16** replace the stale "Phase 0" header in `plan.md` with a pointer to
      this progress file (`docs` label).
      Each body follows the repo's own review discipline: Why / Scope / acceptance criteria /
      artifact check / explicit out-of-scope, with pointers to the spec sections to read first.
      **Observed:** all four issues exist with the exact intended bodies (byte-identical to the
      prepared files via the API), `good first issue` + applicable area labels attached, and zero
      non-ASCII characters after a first-pass encoding defect (Windows clipboard mojibake of
      smart quotes, em dashes and `§`) was found by auditing the posted bodies through the API and
      re-pasting corrected pure-ASCII versions.
      **Surprising:** pasting via the Windows clipboard corrupted typographic characters even
      though the source files were correct; the fix was to avoid `§`, curly quotes and em dashes
      entirely in GitHub bodies.

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

### P3 — art style + images

- [x] **2026-10-30 — preview grid + 6 s clip, and the build is now actually wired.**
      `POST /v1/art-styles` writes the source under the shared `DATA_DIR` with a server-generated
      `references/<styleId>.mp4|mov` key (the untrusted upload name is ignored), then commits the
      `art_style(status='building')` row and `build-art-style` enqueue on one Postgres transaction.
      The API's producer is lazy, preserving the `/health` 503 path when Postgres is down; the
      worker entry point now consumes the queue with `createArtStyleBuildHandler` and closes its DB
      pool on shutdown. `drizzle-orm` is declared directly by the worker instead of being used as a
      hoisted transitive dependency.
      Preview output: an even eight-frame spread from the sampler's 8–24 frames plus one weighted
      palette card; 1280×720 / optional 720×1280 PNG grid; silent H.264 clip exactly 180 frames,
      30 fps and 6.000 s. ffprobe verifies codec, stream count, geometry, fps, frames and duration
      before `status=ready`. A failed build now marks `failed` **and rejects**, so pg-boss's one
      retry runs instead of treating `{status:'failed'}` as a completed job.
      Gate: typecheck + eslint + **825 tests / 59 files** green. Python not run (no media/render
      files touched).
      Artifact (real ffmpeg 9.0.2): a generated 40 s, 640×360 reference with an AAC audio track ran
      through real sampling → numeric analysis → heuristic vision → merge → grid/clip → verification
      and returned `ready`; 8 measured frames, palette weights sum to 1, seed `1903945629`,
      schema-valid profile, decodable 1280×720 PNG, and silent 180-frame clip. The contact sheet was
      opened and visually contains eight ordered reference frames plus the measured palette card.
      **Observed:** the real ffmpeg artifact and hermetic API/queue/worker contracts. **Not observed:**
      the insert+enqueue against Postgres in this run because Docker Desktop was unavailable; the
      existing `test:db` suite was therefore not claimed green.
      Surprises caught only by the artifact pass: the first clip graph used `xstack`, so all nine
      20-frame inputs ended together after ~0.67 s instead of concatenating to 6 s; mocked subprocess
      tests had only asserted `-frames:v 180`. Also, passing all sampled frames failed whenever the
      sampler returned >8, API uploads went to `storage/` while the worker read `.data/`, and resolving
      a failed build silently disabled the queue retry. Each failure now has a contract test.

- [x] **2026-10-30 — `ImagePort` contract + deterministic procedural adapter.**
      `packages/contracts/src/image.ts` pins `cloudflare|pollinations|comfyui|procedural`, strict
      request/result/capability schemas, a 4096 px output ceiling, caller-owned seeds, and
      landscape/portrait geometry checks. `apps/worker/src/ports/image.ts` is the vendor-neutral
      port. `apps/worker/src/image/procedural.ts` is the first real adapter and the zero-key floor:
      seeded flat geometry, 1024×576 / 576×1024, every pixel from the measured `StyleProfile`
      palette, measured ink when outlines are requested, no text/logo/watermark, and a minimal RGB8
      PNG encoder using only `node:zlib` (no ffmpeg, network, GPU, native module or new dependency).
      Tests: 7 contract + 6 adapter; `npm run gate` **838 passed / 61 files**, typecheck and eslint
      clean. Python not run (no media/render files touched).
      Artifact: `landscape.png` (4394 bytes, SHA-256
      `55792c8d0ebabbfd3c7b3a26038fc5481a4c7ae9276833e962aafa0042ee88b4`) and `portrait.png`
      (4835 bytes, `1a7a32b4be9d7c2b0f73a17ebbae26e7a4a3a7d3058cf9823051114a248ab923`) under
      `C:/Users/sanT/AppData/Local/Temp/opencode/facelesspro-procedural-artifact/`; ffprobe reports
      `png`, `rgb24`, exact 1024×576 / 576×1024. Both were opened and visibly use the four supplied
      colours with a faceless geometric subject. Same request → same bytes; changing prompt or seed
      changes bytes.
      **Observed:** contract, deterministic PNG bytes, decoder geometry/pixel format and visual
      artifact. **Not yet built/assumed:** semantic image quality, provider chain, hosted/local model
      adapters, storage and create-images orchestration — those remain separate roadmap tasks.
      Surprise: no SVG/ffmpeg bridge was needed; a filter-none PNG plus zlib is smaller, portable,
      and lets tests inflate every scanline to prove that no colour outside the measured palette
      entered the fallback.

- [x] **2026-10-31 — Cloudflare Flux Schnell image adapter.** The interrupted implementation in
      `apps/worker/src/image/cloudflare.ts` is now verified and recorded: account-scoped Workers AI
      URL, bearer token, final prompt + caller seed + 1–8 steps, 120 s default timeout, bounded
      canonical base64 and JPEG/PNG/WebP signature checks, shared retry taxonomy, and exact
      landscape/portrait output through `image/normalize.ts`. Model, steps and timeout overrides
      are documented in `.env.example`. Cloudflare's current official model page confirms the
      prompt/seed usage, four-step default, eight-step ceiling and base64 image result.
      Contract correction found during the artifact pass: normalization previously relied on
      ffmpeg choosing RGB output; an alpha-capable PNG/WebP could therefore produce RGBA despite
      the documented RGB-PNG boundary. A failing argument test now pins `format=rgb24`, and the
      production filter forces it. 9 adapter + 3 normalizer tests; `npm run gate` green at
      **850 tests / 63 files**. Python not run (no media/render files touched).
      Artifact (real ffmpeg 9.0.2, stubbed exact Cloudflare REST envelope carrying a synthetic
      provider JPEG): `landscape.png` is 1024×576 RGB24 / 6,897 bytes / SHA-256
      `f94a7c9a455593824876b0fcec887aa27314a6c7fdb4572257ec758ef5743feb`; `portrait.png` is
      576×1024 RGB24 / 7,827 bytes / `e220d272dd8dcd6c0c8ecfc6a70489334d9b14329f7c13c84ba30b4f87823fb5`.
      Both were opened and show the expected centred aspect crop; a second full adapter run produced
      the same hashes. Files are under
      `C:/Users/sanT/AppData/Local/Temp/opencode/facelesspro-cloudflare-artifact/`.
      **Observed:** request envelope, validation/classification, real normalization, geometry,
      pixel format and deterministic post-processing. **Not observed:** a live Flux generation or
      its semantic/style quality; no Cloudflare neurons were spent without `LIVE=1`.
      Surprise: Cloudflare's raw input schema omits `seed`, while both official usage examples send
      it. The adapter follows the usage examples; a future live test must keep that discrepancy
      honest.

- [x] **2026-10-31 — Pollinations image adapter, with the keyless path rejected.**
      `apps/worker/src/image/pollinations.ts` targets the current HTTPS
      `gen.pollinations.ai/image/{prompt}` endpoint with canonical
      `black-forest-labs/flux.1-schnell`, exact width/height + caller seed, and a required bearer
      `POLLINATIONS_API_KEY` that never enters the URL. The timeout remains active through the full
      response stream; declared and streamed bodies are capped at 25 MiB; MIME must match
      JPEG/PNG/WebP magic; output goes through the shared exact RGB24 PNG normalizer. The binary
      transport reuses the JSON transport's exported HTTP retry classifier, so 408/425/429/5xx
      cannot drift between adapters. The known watermarked legacy host is rejected at configuration
      time. 13 hermetic tests; `npm run gate` green at **863 tests / 64 files**. Python not run (no
      media/render files touched).
      Accepted artifact (exact current URL/header/query shape through a stubbed provider JPEG, real
      ffmpeg 9.0.2): 1024×576 RGB24 PNG, 6,897 bytes,
      `f94a7c9a455593824876b0fcec887aa27314a6c7fdb4572257ec758ef5743feb`; and 576×1024 RGB24 PNG,
      7,827 bytes, `e220d272dd8dcd6c0c8ecfc6a70489334d9b14329f7c13c84ba30b4f87823fb5`.
      Both were opened and show the expected centred crop. Files are under
      `C:/Users/sanT/AppData/Local/Temp/opencode/facelesspro-pollinations-artifact/`.
      Live evidence changed the design: the current endpoint returned 401 without a key; the old
      `image.pollinations.ai/prompt` endpoint returned 200 keylessly, but the 1024×576 image visibly
      contains `pollinations.ai` in the lower-right even with `nologo=true`. That rejected artifact
      is preserved as `legacy-keyless-watermarked.png` (210,967 bytes, SHA-256
      `e9935bf3d34c11ac69d6a3d0b1d26a85e3d4157a05693979146c349304abfcc6`). We neither ship that
      path nor strip its provider mark; an unconfigured chain will eventually fall through to the
      procedural zero-key floor.
      **Observed:** both live unauthenticated behaviours, current request construction and failure
      taxonomy, bounded streaming, exact normalization and visual artifacts. **Not observed:** an
      authenticated current-model generation or its style quality; no key was available and no
      Pollen was spent. Surprise: Pollinations' current direct-API agent guide still calls image GET
      keyless, contradicting the live 401; artifact evidence wins over copied provider prose.

- [x] **2026-10-31 — self-hosted ComfyUI image adapter.**
      `apps/worker/src/image/comfyui.ts` accepts an operator-exported API-format workflow rather
      than hardcoding SDXL or Flux nodes. Five required placeholders are replaced inside node inputs
      as typed values: final prompt, negative prompt, caller seed, width and height. The template is
      cloned per request, validated as an API graph, and the configured output node must return
      exactly one image. `fixtures/workflows/comfyui-sdxl-api.json` pins the shape and placeholder
      vocabulary; its `sd_xl_base_1.0.safetensors` name is only an editable example, not a bundled
      model. `COMFYUI_WORKFLOW` + `COMFYUI_OUTPUT_NODE` are required before the future factory can
      consider this adapter configured.
      Runtime follows ComfyUI's documented HTTP API without another dependency: `POST /prompt`,
      poll `/history/{prompt_id}`, then fetch `/view` with the returned filename/subfolder/type.
      One abort deadline covers submission, pending waits, JSON bodies and output streaming;
      network/5xx/timeouts are retryable, graph/execution/output failures permanent. Output is
      capped at 25 MiB, MIME must match JPEG/PNG/WebP magic, and the shared normalizer produces the
      exact RGB24 PNG contract. A timeout does not call the global `/interrupt` route, which could
      cancel someone else's local generation. 16 hermetic tests (including fixture compatibility);
      `npm run gate` green at **879 tests / 65 files**. Python not run (no media/render files
      touched).
      Artifact (real localhost HTTP server with the official Comfy route/response shapes, committed
      workflow loaded from disk, one pending history response per job, and real ffmpeg 9.0.2):
      landscape submitted seed 515151 / 1024×576 and produced a 6,897-byte RGB24 PNG,
      `f94a7c9a455593824876b0fcec887aa27314a6c7fdb4572257ec758ef5743feb`; portrait submitted seed
      515152 / 576×1024 and produced 7,827 bytes,
      `e220d272dd8dcd6c0c8ecfc6a70489334d9b14329f7c13c84ba30b4f87823fb5`. Both were decoded by
      ffprobe and opened; files are under
      `C:/Users/sanT/AppData/Local/Temp/opencode/facelesspro-comfyui-artifact/`.
      **Observed:** file loading, typed substitutions, real HTTP submission/poll/download, exact
      output query, pending-state wait, raster checks, normalization, geometry and visual artifact.
      **Not observed:** an actual ComfyUI process, checkpoint/custom nodes, GPU generation or style
      quality; port 8188 timed out and no local model was available. Surprise/design correction:
      `COMFYUI_URL` alone cannot identify a runnable graph, so configuration requires an exported
      workflow and explicit output node instead of pretending one hardcoded SDXL graph also supports
      Flux/GGUF.

- [x] **2026-10-31 — ordered image chain + `IMAGE=...` factory.**
      `apps/worker/src/image/chain.ts` implements `ImageFn` over `ImagePort[]`: the first adapter
      that returns a schema-valid image wins and the result's `degradedFrom` is filled by the chain
      from runtime failures in attempt order, mirroring the planner/vision chains. `ImageChainError`
      carries every diagnosis and is `retryable` only when *all* failures were transient.
      `apps/worker/src/image/factory.ts` parses `IMAGE`, ignores unknown and duplicate names with a
      warning, and constructs adapters in the declared order. An adapter whose credentials or
      workflow are absent is skipped at construction with a warning naming the missing settings;
      that skip is **not** recorded as degradation, because a misconfiguration is not a provider
      outage. `IMAGE` unset — or every named adapter unconfigured — yields the procedural renderer
      alone, preserving zero-key completion. 6 chain + 8 factory tests.
      `npm run gate` green at **893 tests / 67 files**. Python not run (no media/render files
      touched).
      Artifact (real localhost ComfyUI-shaped HTTP stub, hosted providers stubbed at the HTTP
      boundary to return 503/429, real ffmpeg): `IMAGE=cloudflare,pollinations,comfyui,procedural`
      returned `adapter=comfyui`, `degradedFrom=["cloudflare","pollinations"]` for landscape
      (1024×576, 6,897 bytes,
      `f94a7c9a455593824876b0fcec887aa27314a6c7fdb4572257ec758ef5743feb`) and portrait (576×1024,
      7,827 bytes, `e220d272dd8dcd6c0c8ecfc6a70489334d9b14329f7c13c84ba30b4f87823fb5`), with the
      ComfyUI submissions carrying seeds 616161/616162 and matching geometry. Files are under
      `C:/Users/sanT/AppData/Local/Temp/opencode/facelesspro-image-chain-artifact/`.
      **Observed:** configuration ordering, runtime fallthrough, provenance, provider-domain
      routing, ComfyUI construction from env, real normalization and final bytes.
      **Not observed:** a live Cloudflare/Pollinations success inside the chain, a live ComfyUI
      process, or spending any quota; the hosted failures were deliberate HTTP stubs. Surprise: the
      chain must overwrite `degradedFrom` rather than merge it — direct adapters cannot see earlier
      failures, and merging would let an adapter's own empty list erase provenance.

- [x] **2026-10-31 — palette correction + per-scene consistency + one-shot regenerate.**
      `packages/core/src/style/color.ts` (pure) adds sRGB⇄CIELAB D65, CIE76 `deltaE76`, weighted
      `paletteLab`, `correctTowardPalette` (one whole-image LAB translation, capped at 6 ΔE, returns
      a new buffer), soft 4×4×4 `rgbHistogram` and total-variation `histogramDistance`.
      `apps/worker/src/image/postprocess.ts` is the new boundary: decode → correct → encode →
      nearest-neighbour histogram check → optional one-shot regenerate. Decode defaults to ffmpeg;
      encode defaults to the PNG encoder extracted into `image/png.ts` and re-exported by
      `image/procedural.ts`, so the procedural path and the post-processor share one deterministic
      writer. 18 core + 11 worker tests; `npm run gate` green at **922 tests / 69 files**.
      Python not run (no media/render files touched).
      Artifact (real ffmpeg 9.0.2, three 1024×576 provider stills, no provider call): palette
      correction reported exactly 6 ΔE and moved the dominant teal `#2c898a → #41857f`; scene 2
      (off-palette green, nearest distance 0.563) regenerated exactly once with the clause appended
      at the same seed and landed at 0.049; scene 3 at 0.039 was accepted with **zero** draw calls.
      All accepted stills are 1024×576 `rgb24` PNG; dominants `#41857f`, `#438580`, `#448581` show
      the scenes converging. Files and `run.ts` are under
      `C:/Users/sanT/AppData/Local/Temp/opencode/facelesspro-scene-postprocess-artifact/`.
      **Observed:** bounded correction, clause/seed/one-shot behaviour, zero-draw acceptance,
      real decode/encode and geometry. **Not observed:** provider-level style quality after a real
      hosted image (the stills are synthetic) or any multi-video storage/reuse.
      Surprise: the first artifact exposed hard histogram bins scoring two visually identical teals
      `0.885` apart because blue sat at 127 vs 128. Soft tri-linear bins fixed it: the same pair now
      scores ≈0.05, and the test suite pins 127-vs-128 under 0.05 instead of 1.

- [x] **2026-10-31 — CI Python job: restore the deleted `services/media/requirements.txt`.**
      The workflow (`.github/workflows/ci.yml:77`), `README.md` and `docs/10-operations.md` all
      install it, but commit `5a87751` deleted the file and `68de8b8` restored the service without
      it, so `pip install` failed in 1 s and `ruff`/`pytest` had never actually run in CI.
      Restored with the four direct runtime deps pinned to the versions **observed working**
      locally: `edge-tts==7.3.1`, `fastapi==0.141.1`, `pydantic==2.13.4`, `uvicorn==0.54.0`.
      Chose observed versions over the deleted file's `fastapi==0.162.0` / `pydantic==2.14.1`,
      which were never installed here. Python gate green locally: `ruff check app tests` clean,
      `python -m pytest` → **113 passed, 2 skipped** (both `RUN_LIVE=1` provider tests, the
      documented opt-in). Node gate unchanged. **Observed:** Python 3.14.6 resolving all four
      pins as already satisfied. **Not observed:** the GitHub runner installing them on Python
      3.12 until the workflow runs again.

- [x] **2026-10-31 - `GET /v1/art-styles` and `GET /v1/art-styles/:id/export`.**
      The catalog read lives in `packages/db/src/art-styles.ts` because the api lint boundary
      forbids `drizzle-orm`/`pg`: `listReadyArtStyles` filters `status='ready'` and orders
      newest-first, `findArtStyle` returns any status so the route can pick 404 vs 409, and both
      parse rows through `artStyleRowSchema` before the route sees them. `GET /v1/art-styles`
      re-filters on `ready` (a fake or future repository cannot leak a half-built style), rewrites
      storage keys to `/files/<key>` and leaves absolute URLs alone. `GET /:id/export` returns
      exactly `{version: 1, name, formats, profile}` with a full `StyleProfile` re-validated out of
      the jsonb column and no id/key/timestamp, so the file can move between machines; `409` while
      building, `404` unknown, `400 invalid_request` + `field: "id"`, `500 internal` if the stored
      profile is corrupt. Gate: typecheck + eslint + **934 tests / 69 files** green. Python not run
      (no media/render files touched).
      Artifact (real Hono server on 127.0.0.1:3199 with a fake catalog, real HTTP):
      `GET /v1/art-styles` `200` with `previewUrl`, `portraitPreviewUrl` and the sample clip all
      rewritten to `/files/art-styles/<id>/…`, `building`/`failed` rows absent; export `200`, 868
      bytes, `version:1` and the whole profile; `409 conflict`, `404 not_found`, `400` with
      `field:"id"` for building/unknown/malformed ids.
      The artifact caught two gaps the unit tests had missed: `sampleVideoUrls` was still
      `z.array(z.url())`, so the first non-empty local sample key turned the list into a plain-text
      `500` (now `urlOrPathSchema`, like both preview fields), and an unhandled throw had no
      envelope at all (`app.onError` now answers `500 {error:{code:"internal"}}` with a fixed
      message and logs the real error). Both now have tests.
      **Observed:** the exact wire bodies, status codes, path rewriting and error envelopes over a
      real HTTP server. **Not observed:** the two SQL statements executing, because no Postgres is
      available locally (typechecked only, `test:db` not claimed green), and `/files/*` is still a
      P6 Libraries item, so those paths 404 until that route is mounted.

---

## P4 - captions + render - closed (2026-11-05)

- [x] 2026-11-02 — **Caption cue builder** (roadmap P4 task 1). New pure module
      `packages/core/src/captions.ts`: narration word timings → cues under the template rules
      (`wordLimit`, `maxLines`, `maxCharsPerLine`), punctuation priority (a clause-ending word
      closes the cue early instead of padding to `wordLimit`), and shrink-to-fit: a window that
      cannot render inside `maxLines` shrinks rather than overflows. Line width is measured in
      `Intl.Segmenter` grapheme clusters, not code units — the AGENTS.md hard rule "no combining
      mark alone on a line" holds because breaks happen only between words; the one deviation
      from typical Tamil counting is documented: ICU keeps a word-final virama with its
      consonant (`க்ஷ` = 2 clusters, not 1 glyph, never 3 code units). Words are never dropped
      or rewritten — every cue's lines joined with spaces reconstruct the input. Hard errors:
      empty input, or a single word wider than one line. 15 tests. **Observed:** gate green
      70 files / 949 tests (typecheck + eslint + vitest 5). **Not observed:** render against a
      real ffmpeg draw/ASS path yet (that is the ASS-writer task next).

- [x] 2026-11-02 — **ASS writer + bundled fonts** (roadmap P4 task 2). New pure
      `packages/core/src/ass.ts` serialises complete ASS v4+ documents: `H:MM:SS.CC`
      timestamps, `&HAABBGGRR` colour packing, deterministic style/events, one dialogue per
      cue, word-duration `\k` spans (centiseconds, half-up, minimum 1), explicit `\N` from the
      cue builder, brace/backslash escaping, uppercase as presentation only, and template
      font/size/position/highlight/outline mapping. 13 writer tests. Bundled upstream variable
      `Noto Sans` + `Noto Sans Tamil` at Google Fonts revision
      `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`, SHA-256 pinned, SIL OFL 1.1 text and
      `THIRD_PARTY_NOTICES.md` shipped. Font binaries are isolated under `fonts/ttf/` because
      the first artifact run revealed that libass's `fontsdir` tries to parse README/OFL/config
      files as fonts (harmless but noisy); the clean run emits no such warnings.
      `packages/art/src/ass-render.test.ts` uses **real ffmpeg/libass**, asserts the exact bundled
      Tamil file was selected, hard 640×360 RGB output and a non-empty glyph raster; the
      committed 1280×720 golden is `fixtures/render/tamil-frame.png` (pixel digest advisory).
      **Observed:** retained frame `.data/artifacts/p4-ass-writer/tamil-glyph-frame.png`,
      1280×720 RGB24, SHA-256
      `7631e4559a2fa6893969df3964c71096f2ffb3ae1169e6fd6c213341a4a215bc`; visually opened:
      Tamil shaping is intact, current word yellow, remaining words white, no tofu boxes.
      Full gate green: typecheck + eslint + **72 files / 965 tests** (including real ffmpeg).
      **CI surprise/fix:** PR #29's first Node gate failed honestly with
      `spawnSync ffmpeg ENOENT`: the Python job installed ffmpeg but the Node job did not.
      `.github/workflows/ci.yml` now installs ffmpeg in both jobs; the render test remains
      mandatory (not skipped or softened).
      **Not observed:** subtitles over moving footage/audio or 60-second timing (ffmpeg composer
      task, still open).

- [x] 2026-11-02 — **Six built-in caption templates + library endpoint** (roadmap P4 task 3).
      Existing immutable IDs -1…-3 stay byte-for-byte; new -4 `Top Headline`, -5
      `Minimal Center`, -6 `Focus Word` bring the clean seed to six, all bundled-font specs.
      `captionTemplateSchema` now reuses the shared non-zero ID contract, so reserved ID `0`
      is rejected on responses as well as requests/rows. New DB boundary query returns only
      `workspace_id IS NULL`, ordered -1…-6; custom workspace templates remain for P6 auth.
      `GET /v1/caption-templates` strips `workspace_id`, parses the shared response schema,
      sets `Cache-Control: private, max-age=300`, derives a quoted SHA-256 ETag from content,
      and answers matching `If-None-Match` with an empty `304`. Five route tests + one response
      contract test; seed test now pins all IDs and six unique names. **Observed artifact:** real
      HTTP server returned `200`, six IDs/names, ETag
      `"a2f6cd67a22af16eb79ecb0f88c66a10cba1641e06cdbcae199784bedaf75ab0"`;
      conditional request returned `304`, zero bytes. **Not observed:** real Postgres query/seed
      this run — Docker daemon unavailable; clean/existing seed counts remain an explicit DB
      artifact check rather than a compile claim. Full gate green: typecheck + eslint +
      **74 files / 971 tests**.

- [x] 2026-11-03 — **Opt-in emoji sprinkling** (roadmap P4 task 4). New pure
      `packages/core/src/emoji.ts`: ten-emoji allow-list with curated English and Tamil
      topic words (no function words), punctuation/case-insensitive lookup, and emphasis
      detection (cue-final word, or `!`/`?`/`…`/ALL-CAPS mid-cue). Selection scans a cue
      backwards, decorates at most one cue per two (`minCueGap`, configurable upward), and
      is idempotent: an existing `Cue.emoji` is preserved and still counts toward the gap.
      The emoji is a separate presentation field, so `Cue.words`/`Cue.lines` and the
      "join lines reconstructs the narration" invariant are untouched. The ASS writer gains
      `spec.emoji` plus an inline `\fnNoto Emoji` override, validates one grapheme cluster,
      and leaves karaoke spans unchanged. Bundled upstream `NotoEmoji-Variable.ttf`
      (SHA-256 `de6c1883…d27551`, OFL 1.1, same pinned Google Fonts revision) with its own
      notice. 14 emoji tests, 6 ASS emoji tests, and a real-ffmpeg test that renders 🔥 and
      ✅ in identical layouts and fails if the frames are byte-identical (identical tofu).
      Edge trimming is a linear scan, not a `+$` regex: CodeQL correctly flagged the first
      version as a polynomial regex on untrusted caption text. **Observed artifact:** 1280×720
      ffmpeg render of `மிக்க நன்றி!` with a monochrome folded-hands glyph, Tamil shaped
      correctly; the emoji inherits the caption primary colour. Full gate green: typecheck +
      eslint + **75 files / 992 tests**.

- [x] 2026-11-03 — **Deterministic ffmpeg composer** (roadmap P4 task 5). New pure
      `packages/core/src/render.ts` turns stills + durations + the five public motion presets
      into one filter graph: per-still scale/crop/`zoompan`, exact-frame video concat, optional
      ASS burn, narration map, H.264/AAC mux. Scene frames use cumulative rounding, so awkward
      thirds at 60 fps total exactly 60 rather than accumulating independent-rounding drift.
      The profile is `libx264`, CRF 18 at 1080 / 16 above, `yuv420p`, AAC 192k/48 kHz,
      `+faststart`, current `-fps_mode cfr`, metadata stripped and bitexact flags. Pure tests pin
      dimensions, all motion expressions, path escaping, validation and the deterministic arg
      vector; a worker cross-package test prevents the dependency-free core vocabulary drifting
      from contracts. New `packages/art/src/render.ts` only creates the parent, bounds ffmpeg,
      reports stderr on failure and returns observed bytes. **Observed real-ffmpeg gate:** two
      stills + WAV + Tamil ASS produced 1920×1080 H.264/AAC, 30 fps, exactly 45 frames, duration
      within 100 ms, visible red→blue cut and >500 burned-caption pixels; rendering the same
      inputs to a second path produced byte-identical MP4. **Observed artifacts:** cached real
      Valluvar narration → 2.933333 s / 88-frame English render, SHA-256
      `f0fb6ac6…e8c595a`; Tamil shaping/tone render → 2.400000 s / 72 frames, SHA-256
      `99fcbaeb…56f84c1`; four sampled frames visually checked for scene cuts, karaoke and Tamil
      shaping. **Not observed:** 60 fps, portrait, 2K/4K and green-screen artifacts — those are
      the next roadmap task; the P4 60-second end-to-end gate remains open. Full gate green:
      typecheck + eslint + **78 files / 1011 tests**.

- [x] 2026-11-03 — **Render format/profile matrix** (roadmap P4 task 6). The pure
      composer now requires the public `standard|greenscreen` format vocabulary (cross-checked
      against contracts). Standard keeps one still input per scene. Greenscreen reads **no**
      stills: it generates exact `#00FF00` at the requested dimensions/fps, trims by cumulative
      `end_frame`, maps narration as input 0 and burns the same ASS overlay chain. Pure tests
      build 30/60 fps × 1080/1440/2160 and require exact frame totals; landscape and portrait
      short-edge geometry stays pinned. **Observed mandatory real-ffmpeg gate:** a deliberately
      missing still still produced captioned portrait 2160×3840 H.264/AAC at 60 fps, exactly six
      frames, within 100 ms, with a clean green centre and >1,000 Tamil-caption pixels.
      **Observed profile artifacts:** standard 2K/60, 0.500 s / 30 frames / 277,474 bytes,
      SHA-256 `a559f748…87e6b30`; captioned greenscreen portrait 4K/60, 0.500 s / 30 frames /
      56,034 bytes, SHA-256 `d03bcc48…ff9fec2`. Extracted frames visually checked: Tamil shapes
      correctly and the green canvas is uniform behind the overlay. **Not observed:** a long 4K
      production render or chroma-keying in a third-party editor; the P4 60-second watch gate
      remains open. Full gate green: typecheck + eslint + **78 files / 1015 tests**.

- [x] 2026-11-03 — **Portable caption sidecars** (roadmap P4 task 7). New pure
      `packages/core/src/caption-export.ts` serializes the same validated cues as SRT, WebVTT,
      existing karaoke ASS or stable pretty JSON v1. SRT/VTT retain line breaks and exact
      milliseconds (`comma` vs `dot`), append optional emoji only to a copied final line, and
      carry stable extension/MIME metadata. JSON keeps sequential indexes, raw lines, global
      word timings and separate one-cluster emoji; its strict shared contract rejects paths,
      unknown fields, timing/line drift, overlap and a false final duration. ASS dispatch reuses
      the bundled-font writer and requires PlayRes dimensions. Cross-package tests pin the
      dependency-free format tuple/schema parity. **Observed real-ffmpeg gate:** libass parsed
      generated Tamil SRT and WebVTT, selected the bundled Tamil font and rasterized >500 pixels
      from each. **Observed bilingual artifacts:** SRT 147 B SHA-256 `cab0d7d4…05fd7bc`, VTT
      155 B `465e8c32…fbfaf94`, ASS 809 B `49aed464…ac029b7`, JSON 960 B
      `382f7868…6ef5d26`; inspected VTT frame showed correctly shaped Tamil, Latin and the
      allow-listed check glyph. **Not observed:** persisted `caption_track` writes or
      `GET /v1/videos/:id/captions`; those require the P5 pipeline/P6 authenticated video route.
      Full gate green: typecheck + eslint + **81 files / 1034 tests**.

- [x] 2026-11-03 — **Verified thumbnail extraction** (roadmap P4 task 8). New pure
      `packages/core/src/thumbnail.ts` chooses 25% of the final duration and caps the long edge
      at 1280 without upscaling/distortion; very short videos clamp inside their duration. New
      `packages/art/src/thumbnail.ts` ffprobes source metadata, seeks that exact millisecond,
      Lanczos-scales one RGB PNG and writes `<output>.part`; PNG signature + IHDR geometry must
      verify before atomic rename. Missing/probe/extract failures remove the partial, while retry
      over an existing thumbnail is byte-idempotent. **Observed mandatory real-ffmpeg gate:** a
      4.000 s 1920×1080 source switched red→blue at 0.5 s; extraction selected 1.000 s, produced
      1280×720, and the centre pixel was blue (not frame zero). Re-running produced identical
      bytes and one final file. **Observed artifact:** 4,352-byte PNG, SHA-256
      `b2419fd5…8794c3fd`, visually inspected as uniform blue. **Not observed:** thumbnail wiring
      into a persisted render row/`thumbnailUrl` (P5). The P4 60-second watch/listening artifact
      gate remains open. Full gate green: typecheck + eslint + **83 files / 1044 tests**.

- [x] 2026-11-03 — **Stereo AAC playback compatibility fix** (user-reported P4 gate defect).
      The first 61-second candidate carried valid AAC-LC mono: ffprobe showed 48 kHz/61.038 s,
      decoding produced full PCM, and volume measured −15.5 dB mean / −1.6 dB peak — but the
      user heard no voice in their playback path, so the artifact failed regardless of metadata.
      The composer now explicitly emits AAC-LC 192 kbps/48 kHz **stereo** (`-ac 2`); both standard
      and 4K greenscreen real-ffmpeg tests probe and require two channels. Regenerated candidate
      at the same path is 7,841,120 bytes, SHA-256 `a5ec00fd…8950646`, 61.038 s, stereo from time
      zero; a standalone MP3 voice check is beside it. **Observed:** ffmpeg decodes both channels;
      automated duration/drift/caption checks remain green. **Not observed:** user playback of
      the replacement — P4 human watch/listening gate remains open. Full gate green: typecheck +
      eslint + **83 files / 1044 tests**.

- [x] 2026-11-05 — **P4 CLOSED: the replacement 61-second render passed the human playback
      gate.** The user played `.data/p4-gate/p4-tamil-caption-gate.mp4` in their normal player and
      approved audible voice throughout, caption-to-word timing through the end, Tamil shaping and
      final A/V sync. This is the required human verdict, not an inference from metadata.
      Rechecked immediately before approval: `npm run gate` green at **83 files / 1044 tests**;
      `ruff check app tests` clean; `python -m pytest` **113 passed / 2 opt-in LIVE tests not run**.
      ffprobe observed 1920x1080 H.264 at 30 fps, 1,831 frames, 61.038 s overall, and AAC-LC
      48 kHz stereo starting at 0.000 s; SHA-256
      `a5ec00fd82ec57f04b79656c209be7c587092d139435d87669744bee28950646`.
      Sampled frames at 5, 35 and 60 seconds were opened again and show intact Tamil/Latin shaping
      and karaoke highlighting. **Observed:** automated invariants plus the user's actual playback
      verdict. **Assumed:** nothing required by the P4 gate.

---

## P5 - V3 pipeline - in progress

- [x] 2026-11-05 — **`create-scenes` is the first real video pipeline step.** The worker now
      registers only supplied stable step handlers; production wires `create-scenes` to the
      configured planner chain while the four later queues remain deliberately unconsumed. The
      handler re-parses the stored V3 request, requires a ready/orientation-compatible style that
      is workspace-owned or published, validates its `StyleProfile`, and deterministically maps
      prompt prefix + palette/line/background/composition + required negative terms into every
      scene prompt. Planning stays outside the transaction. One `withStep` commit writes the
      schema-valid plan, estimated `duration_ms`, ordered scene rows and `create-vocal` enqueue;
      all-transient planner-chain failures retain retryability. Script reconstruction is checked
      again before any write. Voiceover remains the separate ASR task and currently fails with
      `unprocessable` rather than silently running TTS.
      Tests: 12 step tests + 2 worker-wiring tests; `npm run gate` green at **84 files / 1058
      tests**. `npm run test:db` now runs package and app DB suites serially and passed **15/15**.
      Real artifact path: `.data/artifacts/p5-create-scenes/plan.json`; the actual pg-boss consumer
      planned `fixtures/scripts/tamil-mixed.txt` through the heuristic floor into 3 scenes ending
      at 41,700 ms, persisted exact reconstructable Tamil/English text, advanced to
      `create-vocal`, enqueued exactly one next job, wrote no zero-unit ledger row, and a duplicate
      delivery called the planner once total and inserted no duplicate scenes/jobs.
      **Spec correction:** docs/04 previously promised an `action=plan, units=0` ledger row, but
      `charge()` deliberately and correctly omits zero-unit noise; planner provenance is in
      `video.plan`, with runtime observability reserved for `job_event`.
      **Surprise:** adding a second DB test file exposed that Vitest ran files concurrently while
      both purged global pg-boss queue names, so one suite could erase the other's just-enqueued
      artifact. `vitest.db.config.ts` now sets `fileParallelism: false`; application rows remain
      isolated by workspace. **Observed:** queue → worker → planner → one Postgres transaction →
      next queue, plus the retained plan artifact. **Assumed:** hosted planner quality remains
      unobserved; the artifact intentionally used the offline heuristic and no provider network.
      Python was not run because no media/render code changed.

- [x] 2026-11-05 — **`create-vocal` turns stored scenes into one narration master and re-derives
      scene spans from real audio.** `TtsPort` (`apps/worker/src/ports/tts.ts`) owns the pair +
      synthesis boundary; `tts/media.ts` implements it against the media service, with the same
      retry taxonomy as the planner transport (network/timeout/408/425/429/5xx retryable; 4xx and
      an unreadable `200` permanent). `voiceId` is a **pair id**; absent it, `TTS_PAIR`
      (`valluvar`) is used. Each scene is planned independently, then every run is sent in one
      `POST /synthesize`; response segments are validated 1:1 against the request before any
      write. Scene *i* starts at its first run and ends where scene *i+1* begins, so spans are
      contiguous and the last ends exactly on the probed master duration, which also becomes
      `video.duration_ms`. The encoded master is stored before the single commit; the transaction
      writes the `asset`, `narration` (`word_timings`, `voice_plan`), scene spans, video duration,
      one `action=tts` ledger row (`units=characters`, `unit_cost` from `TTS_UNIT_COST`, 0 here)
      and the `create-images` enqueue. A duplicate delivery is stale and writes nothing.
      The media response now exposes both `master_path` (frame-exact WAV timing source) and
      `master_mp3_path` (the encoded master the pipeline stores); contracts and pydantic mirror
      each other and the fixture test covers both.
      Tests: 10 adapter tests + 15 step tests + 3 contract tests; `npm run gate` green at
      **86 files / 1085 tests**. `npm run test:db` passed **16/16**, including a real
      ffmpeg/ffprobe 2.4 s MP3 stored byte-identically at
      `.data/artifacts/p5-create-vocal/narration.mp3` (39,331 bytes, SHA-256
      `3fae8cd8b36d0b61bc6b5a07742a8e2c56095c3d70672739eb19bbc17c70e18d`), with
      `.data/artifacts/p5-create-vocal/narration.json` recording spans 0–1200–2400 ms and the
      word timeline. Python: `pytest services/media` passed (113 passed, 2 LIVE skipped) and
      `ruff check` clean.
      A separate **manual live check** through the real media service (edge-tts, `valluvar`, two
      runs: one Tamil sentence and one English sentence) produced
      `.data/artifacts/p5-create-vocal/live/narration-live.mp3`: 3.492 s, mono 48 kHz MP3, 85,292
      bytes, SHA-256 `9fe1a5ab0ed7b7d958c8b85ad7d75695fdaf69dee1f3d63fb5303abcff06bd72`, with
      starts at 0 and 1,502 ms and 8 word timings. That call exercised the media contract and the
      encoded-master hand-off; the **worker step itself was not run live end-to-end**.
      **Implemented limits (recorded, not hidden):** `voiceStyle` is still ignored by the media
      service; `voiceoverUrl` fails `unprocessable` until the ASR/upload step exists; there is one
      master file, not per-scene extracts; and the adapter reads `master_mp3_path` from disk, so the
      worker and media service must share `MEDIA_DATA_DIR` on one host (a remote split needs a
      download endpoint).
      **Observed:** worker → fake TTS → one real Postgres transaction → `create-images`, a
      byte-identical stored master, and one real Tamil/English media synthesis. **Assumed:** the
      listening gate for this step is still open — the artifact proves format, duration and
      timing, not whether the narration sounds right; live worker latency/retry behaviour remains
      unobserved because the DB test injected a synthetic timeline and never touched the network.

- [x] 2026-11-05 — **`create-images` generates, post-processes, stores and links one still per
      planned scene.** Production now consumes the queue with the configured `IMAGE` chain. The
      step re-parses the stored V3 request and `ScenePlan`, re-checks style visibility/readiness/
      orientation, validates the `StyleProfile`, and requires ordered scene rows whose text still
      matches the plan. It reuses the already style-composed `imagePrompt`, adds the required
      `text, watermark, logo, signature` negative terms, and derives each caller-owned seed with
      pure `sceneSeedFor(videoId, idx)`. Scenes run in order through the existing palette correction
      and nearest-prior-frame consistency guard; any outlier redraws at most once with the same
      seed. Frames are written before the commit to
      `ws/<workspace>/videos/<video>/frames/0001.png …`, with a strict v1
      `frames/manifest.json` contract recording the accepted prompt, seed, adapter/degradation,
      geometry, bytes, SHA-256, ΔE and regenerate result. The one fenced transaction inserts one
      `image` asset per frame, links `scene.image_asset_id`, charges `action=image` with
      `units=ceil(scenes/20)` and `IMAGE_UNIT_COST` (0 here), and advances to `create-captions`.
      Disk failures stay retryable with no commit, image-chain failures preserve their retryability,
      and a stale duplicate delivery writes or charges nothing.
      Tests: 14 step tests, 10 image-contract tests and 3 scene-seed tests; `npm run gate` green at
      **87 files / 1,105 tests**. `npm run test:db` passed **4 files / 17 tests**. The real DB test
      exercised pg-boss, the procedural adapter, real ffmpeg decode, PNG re-encode and Postgres:
      two linked 1024×576 RGB24 frames, one manifest, one ledger row, one `create-captions` job and
      no duplicate work. Retained artifact `.data/artifacts/p5-create-images/frame-0001.png` is
      3,818 bytes, SHA-256
      `7e79e4eb84d808424136a17758ecb7bcbd5966f48e1c04c95b827ea5963390c7`; its manifest and audit
      summary are beside it. `pytest services/media` remained green (113 passed, 2 LIVE skipped)
      and `ruff check services/media` was clean.
      **Surprise / documented limit:** cross-scene quality is order-dependent, so P5.3 intentionally
      generates sequentially; `IMAGE_CONCURRENCY=3` is reserved rather than falsely applied.
      `frames/manifest.json` remains a disk artifact because the public asset vocabulary has no
      manifest kind. The planned per-scene image-result cache has not landed: deterministic keys
      make disk retries overwrite safely, but a pre-commit retry can call a hosted provider again.
      **Observed:** queue → procedural generation → real image post-processing →
      disk + one Postgres transaction → `create-captions`; the retained image is a valid, visibly
      on-palette abstract fallback with no text/logo/watermark. **Assumed:** hosted-provider visual
      quality, latency, throttling and one-shot regeneration under a real outlier remain unobserved;
      the offline procedural floor proves orchestration and artifact invariants, not semantic art
      quality.

- [x] 2026-11-05 — **`create-captions` persists one lossless cue track and four matching
      sidecars, or cleanly skips when V3 captions are disabled.** Production now consumes the
      queue. The enabled branch selects a global built-in or workspace-owned template (omitted id
      temporarily defaults to `-1` until workspace preferences exist), validates positive ordered
      global narration words inside the master, groups them with template word/line limits and
      32-landscape/18-portrait grapheme-cell budgets, then applies the existing deterministic emoji
      pass. ASS, SRT, VTT and strict JSON v1 are all serialized from that same cue list; JSON is
      parsed back through the shared contract before disk I/O. ASS uses one reusable 1080p
      landscape/portrait PlayRes canvas so libass can scale it on later 2K/4K renders. Files are
      written before the commit under `ws/<workspace>/videos/<video>/captions.*`. One fenced
      transaction inserts four `caption` assets, the cue track, `action=subtitles` (`units=1`,
      `SUBTITLE_UNIT_COST=20` by default) and moves the cursor. With `render` requested it becomes
      `status=rendering` / `step=render` and enqueues one render job; with `render` omitted (an
      editable project, docs/01 §2) it sets `status=completed` / `step=null` and enqueues nothing.
      `captions:false` likewise advances with no template/narration lookup, artifact, track or
      ledger row. Disk failures stay retryable; an over-wide word is permanent `unprocessable`
      rather than splitting a Tamil grapheme cluster; stale delivery writes and charges nothing.
      **Contract correction:** the old `caption_track.cues` placeholder stored only
      `{text,startMs,endMs}`, which could not reconstruct line breaks, karaoke words or emoji. It
      now stores raw lines, global timed words, cue times and optional one-cluster emoji, validates
      cross-cue overlap, and rejects template id 0. This is a JSONB shape correction with no DDL
      migration; docs/01, 03 and 07 were updated in the same task.
      Tests: 16 step tests plus the strengthened row contract; `npm run gate` green at **88 files /
      1,121 tests**. `npm run test:db` passed **5 files / 18 tests**. The real integration test ran
      pg-boss → worker → disk + Postgres → render queue, verified four byte-identical assets and a
      track equal to JSON cues minus export indexes, recorded one −20 subtitles row, and proved a
      duplicate delivery remained stale. It then rendered the retained ASS with real
      ffmpeg/libass, which selected `NotoSansTamil-Variable.ttf`; the opened 1920×1080 RGB24 frame
      shows intact Tamil shaping and karaoke colour. Artifacts:
      `.data/artifacts/p5-create-captions/captions.{ass,srt,vtt,json}` and
      `caption-frame.png` (30,037 bytes, SHA-256
      `76a321b55614634ec23c43b18e173873e64de0fbf5e442aae780c3f042eb6a1c`); ASS is 790 bytes,
      SHA-256 `168bf33e0b0ff1427cc7b788dd7dfc8de36c875fa64fc61147cddb2621c9d898`.
      `pytest services/media` remained green (113 passed, 2 LIVE skipped) and Ruff was clean.
      **Observed:** exact cue/sidecar parity, bundled-font selection, Tamil raster, atomic database
      writes and render enqueue. **Assumed:** this exact persisted ASS has not yet travelled through
      the production render step or a 2K/4K re-render; P5.5 is deliberately not started here.

- [x] 2026-11-05 — **`render` turns the stored timeline into one verified MP4 + thumbnail and
      completes the video.** The worker now consumes all five step queues. The step re-parses the
      stored V3 request, requires its `render` block, and refuses to spawn ffmpeg unless the stored
      timeline tiles the narration exactly: scenes ordered by `idx`, spans starting at 0 and
      contiguous, the final `end_ms` equal to both `narration.duration_ms` and
      `video.duration_ms`, every scene owning an `image` asset and an implemented motion preset, and
      the narration asset of kind `audio` in the same workspace. Those are `internal` failures with
      no commit because a gap would silently cut audio. Composition and encoding stay in the pure
      `buildRenderPlan` + thin ffmpeg adapter; this step only resolves keys, checks the encoder
      actually returned the requested width/height/fps/duration, then extracts the 25% thumbnail.
      MP4 and PNG are written before the commit under
      `ws/<workspace>/videos/<video>/render-<resolution>p-<fps>-<format>.mp4` and
      `thumbnail-<resolution>p-<fps>-<format>.png`. One fenced transaction inserts both asset rows,
      the completed `render` row, sets `video.video_url` (a storage key; the api maps it to
      `/files/*`) and `duration_ms`, charges `action=render` with `units=minutes` and
      `RENDER_UNIT_COST` (10 by default, doubled at 60 fps), then advances. `render` is last, so
      that advance is what `status=completed` / `step=null` means. ASS is burned only when a
      `caption_track` row exists, and fonts always come from `BUNDLED_CAPTION_FONTS_URL`, never the
      host fontconfig. ffmpeg/thumbnail failures stay retryable and write nothing; a stale duplicate
      delivery writes and charges nothing.
      **Spec correction:** docs/03 promised `render-1080p-30.mp4`, but a greenscreen or profile
      change must not clobber the previous object, so the key now includes the format (docs/03 §5
      and docs/04 §6 were updated here). `RENDER_UNIT_COST` is documented in docs/10 and
      `.env.example`.
      Tests: 20 hermetic step tests; `npm run gate` green at **89 files / 1,141 tests**.
      `npm run test:db` passed **6 files / 19 tests**. The real integration test ran
      pg-boss → worker → real ffmpeg/libass → Postgres: 1920×1080 H.264 yuv420p 30/1, stereo
      AAC-LC 48 kHz, exactly 2.000 s, a 1280×720 RGB thumbnail, both asset rows, one completed
      `render` row, `video_url`/`duration_ms`, one `action=render` ledger row
      (`units=0.03`, `unit_cost=10`, `delta=-0.3`) and `status=completed`/`step=null`; a duplicate
      delivery added no row, asset or charge. Retained P5 artifact
      `.data/artifacts/p5-render/final.mp4` (63,338 bytes, SHA-256
      `380395e3f99fd9f1f3124f9bed3646c73c0ce397f92c9d08008b3a76518e1893`), `thumbnail.png`
      (33,647 bytes, SHA-256
      `28b5ea86038152396ac8779caa41a56ec214ec9464bd9c51fe1fbdfe75cfbef0`) and `summary.json`.
      Frames extracted at 0.4 s and 1.5 s and the thumbnail were opened: each half shows its own
      scene image and motion clip, and the Tamil cue `வணக்கம் நண்பர்களே.` / `Today fire!` is burned
      in with intact shaping, no split clusters, and at 0.4 s the first word is yellow (karaoke)
      while the second is still white. `pytest services/media`
      remained green (113 passed, 2 LIVE skipped) and Ruff was clean.
      **Observed:** queue → step → real MP4/thumbnail → one Postgres transaction → terminal state,
      plus the opened Tamil-captioned frames. **Assumed:** the P5 phase gate is still open — no
      real 3-minute mixed-language video has been rendered, the 4K/60 greenscreen profile was
      proven at the art-adapter level but not through this step, and kill-and-resume, retry-from-step
      and `POST /v1/videos/:id/render` (the 60 fps re-render path) belong to the next P5 tasks.

- [x] 2026-11-05 — **`GET /v1/videos/:id` exposes the pipeline cursor, including the finished MP4.**
      New `apps/api/src/videos.ts` returns exactly `videoResponseSchema` (the same object webhooks
      will carry). `render` answers the stored create request's presence, `step` stays populated
      after a failure because it is the resume point, and `error` is the recorded `{code, message}`
      or `null`. The stored render key is rewritten to an absolute `<PUBLIC_BASE_URL>/files/…` URL
      (absolute values pass through, a trailing base slash never doubles); a completed row without
      a render key or a stored error that no longer matches the public envelope is a fixed `500`
      rather than a broken 200. Unknown id → `404`, non-UUID → `400` with `field: "id"`. The real
      dependency is `findVideo` (`packages/db/src/videos.ts`), which parses through
      `videoRowSchema` so the route can never meet an unparsed cursor. `server.ts` wires
      `PUBLIC_BASE_URL` with the listen address as a local-dev fallback.
      Tests: 9 hermetic route tests + 1 real-Postgres test; `npm run gate` green at **90 files /
      1,150 tests**. `npm run test:db` passed **7 files / 20 tests**; the integration test inserted
      a workspace + completed video, served it through `findVideo` + the route, and observed an
      absolute `/files/…` render URL, `error: null`, `durationMs`, and UTC `Z` timestamps; a random
      UUID returned `404`. Docs/07 §2.2 now states these semantics and docs/08 lists both tests.
      **Documented gap:** `thumbnailUrl` and `scenes` stay absent — the schema links only the mp4
      and there is no `video → thumbnail` column yet, so publishing it would mean guessing from a
      storage key. **Observed:** in-process Hono request + real Postgres. **Assumed:** no create
      route exists yet, so `PUBLIC_BASE_URL` behind a proxy and a live HTTP origin are unobserved;
      `POST /v1/videos/:id/render` and the retry/kill-and-resume evidence remain open.

- [x] 2026-11-07 — **`POST /v1/videos/:id/render` re-renders a completed video, guarded by `409`.**
      The route accepts `{}` (1080p / 30 fps / `standard` defaults), a subset of
      `resolution`/`frameRate`/`format` and an optional https `webhookUrl`; malformed JSON, unknown
      keys, `720`, 24/25 fps and non-https webhooks are `400` naming the field. Only `completed` is
      renderable — `processing`, `rendering` and `failed` are `409 conflict` — because a failure is
      resumed by retrying `step`, not by rendering a half-built project (docs/01 §2 rule 4 corrected
      from 400 to 409). `beginRender` (`packages/db/src/videos.ts`) takes `for update` on the row,
      then writes `status=rendering`, `step=render`, `error=null`, the merged
      `request.body.render` and, when supplied, the new `webhook_url`. `createQueueRender`
      (`apps/api/src/render-queue.ts`) opens one transaction, calls `beginRender`, enqueues `render`
      through the same client and commits, so a `202` means exactly one queued job and a `409`
      changed nothing. Success is `202` + `videoResponseSchema` built by the mapper extracted to
      `apps/api/src/video-response.ts`; the previous `videoUrl` stays playable until the step
      replaces the MP4.
      Tests: 14 hermetic route tests + 4 real-Postgres/pg-boss tests; `npm run gate` green at
      **91 files / 1,164 tests**; `npm run test:db` passed **8 files / 24 tests**. The integration
      test observed `completed → rendering/render`, a stored profile of
      2160/60/greenscreen with `script`/`artStyleId` intact, the persisted webhook, one `render`
      job carrying `{videoId}`; a second call was `409` with profile and queue unchanged; a `failed`
      video returned `409`, kept `step=create-images`, and queued nothing.
      **Observed:** in-process Hono request → real Postgres transaction + pg-boss insert.
      **Assumed:** the worker consuming this re-render into a 60 fps artifact, kill-and-resume and
      retry-from-step evidence remain open — the P5 phase gate is still not claimed.

- [x] 2026-11-07 — **`POST /v1/videos/:id/retry` resumes a failed video at its recorded step.**
      The endpoint accepts only `failed` with a non-null `step`: it clears `error`, moves the video
      to `processing` (or back to `rendering` when the failed step is `render`), re-enqueues that
      one step and returns `202` + `videoResponseSchema`. Earlier steps keep their artifacts and
      ledger rows, and the retry itself writes no ledger row — the resumed step owns its single
      charge on commit. `processing`/`rendering`/`completed` → `409 conflict`, unknown id → `404`,
      non-UUID → `400` with `field: "id"`. `beginRetry` (`packages/db/src/videos.ts`) takes the row
      `for update`; `createQueueRetry` shares one transaction with the enqueue, so a double-click
      yields one accepted retry and one `409`, never two jobs. The queue builders moved to
      `apps/api/src/video-queues.ts` and now share the transaction/enqueue plumbing.
      Tests: 8 hermetic route tests + 5 real-Postgres/pg-boss tests; `npm run gate` green at
      **92 files / 1,172 tests**; `npm run test:db` passed **9 files / 29 tests**. The integration
      test observed a failed `create-images` video re-queued exactly once on that queue with
      `{videoId}`, `error` cleared, the stored request untouched and zero ledger rows; a failed
      `render` returned to `rendering` with the old mp4 still served; a second retry was `409` with
      one job left; `completed` was `409` and queued nothing.
      **Observed:** in-process Hono request → real Postgres transaction + pg-boss insert.
      **Assumed:** that the resumed worker run itself succeeds (and the kill-and-resume no-double-
      charge evidence) is still open — the P5 phase gate is not claimed.
      **Process deviation:** the route was implemented before its test file, so this task has no
      red-run artifact; the 8 hermetic and 5 real-DB tests were green on first execution.

- [x] 2026-11-07 — **`job_event` gives every step attempt an append-only telemetry row.**
      `packages/contracts/src/db.ts` adds table 18 with `JOB_EVENT_OUTCOMES` = `committed`,
      `reused`, `stale`, `locked`, `superseded`, `failed`, `retryable`, `missing` — `retryable`
      exists only in events because a retryable failure is rethrown, not returned; `missing` is
      defined but never recorded, since a deleted video leaves no FK target to attach the row to.
      The drizzle table (`job_event`, index `job_event_video_idx`) landed as migration
      `0001_omniscient_falcon.sql` and `npm run db:migrate` now reports **18 tables, 2
      migrations** (the hard-coded count check in `packages/db/src/migrate.ts` was raised to 18).
      `withStep` gained `ctx.observe({adapter, items, ok, failed, bytes, costUnits,
      degradedFrom})` — merged per attempt in `packages/queue/src/step.ts` — and writes exactly
      one `job_event` row per attempt after the outcome, `duration_ms` measured with
      `Date.now()` in the queue layer. Writes are best-effort: a failed insert is logged
      (`[queue] job_event write failed`), never fatal, and events are never part of the commit
      transaction, so telemetry cannot change pipeline state. All five steps report what they
      actually have: scenes = planner adapter/items/degraded chain; vocal = segment count,
      master bytes, character units; images = adapter/chain, frames ok, total bytes, lot units;
      captions = cues, export bytes, 1 unit; render = scenes, output bytes, fractional minutes
      (numeric(12,2) holds it).
      Tests: contract row test covers every metric column plus invalid outcome/negative-metric
      rejection; `step.db.test.ts` asserts the committed row with observed metrics, `failed`
      with the error payload, `retryable`, `stale` (attempt null), `locked`, `reused`,
      `superseded` and zero rows for a `missing` video; the five worker step harnesses pass
      `observe: vi.fn()` and create-scenes asserts its metric call. `npm run gate` green at
      **92 files / 1,173 tests**; `npm run test:db` passed **9 files / 29 tests** against the
      real Postgres.
      **Observed:** migration applied on the live container; real-Postgres rows for every
      outcome above, read back through `jobEventRowSchema`.
      **Assumed:** that nothing in the editor/ops path reads these rows yet — nothing does,
      which is exactly why writes being best-effort cannot lose state.
      **Process deviation:** no red-run artifact; the schema/contract tests were updated in the
      same pass as the implementation, so the first full run was already green.

- [x] 2026-11-07 — **`voiceoverUrl` step 1 of 3: the ASR boundary exists.**
      `POST /transcribe` on the media service: raw audio bytes in (no multipart —
      `python-multipart` is not installed and the worker owns the download anyway), and out
      comes what the pipeline needs to treat the transcript as the script: ISO-639-1 language,
      duration, sentence-level segments and **global** word timings, mirrored field-for-field
      as `asrSegmentSchema`/`transcribeResponseSchema` in `packages/contracts/src/media.ts`
      (`words` ≥ 1 per segment, positive spans; silence-only audio is a 502, never an empty
      success). `services/media/app/asr.py` defines the engine boundary (`AsrEngine`,
      `AsrError`, `AsrUnavailableError`) with `WhisperLocalEngine` as rank 1 (docs/06 §1.4):
      faster-whisper is a **lazy optional import** because its wheels lag CPython 3.14 — the
      service boots without it and `/transcribe` answers **503 naming the package**; the model
      runs at int8/CPU with `word_timestamps` via `asyncio.to_thread`, and segments without
      usable word timings are dropped rather than shipped. Config: `ASR_MODEL`
      (default `large-v3-turbo`), `ASR_MAX_MB` (default 200, matching the worker's download
      cap; 413 before the engine runs, 422 on an empty upload). Each transcription writes
      `transcript.json` under `<request_id>/`. Endpoint errors follow the synthesize
      precedent (type name in the detail, never the message).
      Tests: 8 hermetic endpoint tests + 1 RUN_LIVE round-trip (synthesize a Tamil clip →
      transcribe the encoded master back), plus 2 contract tests. `python -m pytest` green at
      **120 passed, 3 skipped** (LIVE), `ruff check` clean; `npm run gate` green at
      **92 files / 1,175 tests**. Artifact: real `uvicorn` boot on 8137 — `GET /health` 200 and
      `POST /transcribe` **503** with `faster-whisper is not installed…` (verified by curl).
      **Observed:** the boundary, its degradation and its artifact, against the running
      service. **Unproven:** the real model — faster-whisper cannot install on this
      interpreter's Python 3.14, so the RUN_LIVE test is the gate for when it can; the worker
      download (step 2) and the `create-scenes` voiceover branch (step 3) do not exist yet, so
      the docs/09 P5 `voiceoverUrl` item stays open.

- [x] 2026-11-07 — **`voiceoverUrl` step 2 of 3: the worker can fetch one and ask for a transcript.**
      `apps/worker/src/voiceover/download.ts` (`downloadVoiceover`, `VoiceoverDownloadError`,
      `extensionOf`, `mimeForAudioExtension`) is the one place the worker touches an arbitrary
      host. Guardrails, all enforced in code: **HTTPS only** (`redirect: 'manual'`, so every hop
      is re-validated — an https URL cannot bounce to plaintext or to a non-audio document), the
      `AUDIO_EXTENSIONS` allow-list (which also picks the ASR mime), `MAX_VOICEOVER_BYTES`
      enforced on both the declared `content-length` (rejected **before** a body reader exists)
      and the live stream (reader cancelled mid-flight), bounded redirects (default 4 → at most
      5 requests), 120 s ceiling and an injected `fetchImpl`. Failures are `invalid_request`
      permanent for a bad URL/scheme/extension, `payload_too_large` permanent for over-cap,
      `upstream_failed` for HTTP/network/redirect problems with
      `isRetryableHttpStatus` deciding retryability (a bad redirect is permanent). An empty body
      is a permanent upstream failure. `apps/worker/src/ports/asr.ts` defines `AsrPort`
      (`transcribe({ audio, mime })` → `AsrTranscription` with sentence segments and **global**
      camelCase word timings), and `apps/worker/src/asr/media.ts` is the media-service adapter:
      one raw-body `POST /transcribe` (no multipart/JSON wrapper), the contract parsed with
      `transcribeResponseSchema`, and the TTS adapter's taxonomy with one deliberate exception —
      the service's **502 is permanent** ("decoded, but no usable speech"; retrying identical
      bytes cannot help) while **503 stays retryable** (engine missing/not loaded). Empty audio
      and a non-audio mime are refused before any request.
      Tests: 13 downloader tests + 12 adapter tests, all hermetic (injected fetch, no socket).
      `npm run gate` green at **94 files / 1,200 tests**. Artifact: a real `tsx` run of the
      adapter against a real `uvicorn` on 8138 returned `AsrPortError status=503
      retryable=true :: … faster-whisper is not installed …` (confirmed in the server log), and
      the downloader refused `http://…/audio.mp3` and `https://…/notes.txt` as
      `invalid_request` without opening a connection.
      **Observed:** both guardrail paths and the adapter→service hand-off. **Unproven:** an
      actual successful transcription (needs faster-whisper, unavailable on Python 3.14 here),
      and the `create-scenes` branch (step 3) is still absent, so the docs/09 P5 item stays open.

- [x] 2026-11-08 — **`voiceoverUrl` step 3 of 3: `create-scenes` turns an uploaded voiceover into
      the scene plan, and `create-vocal` steps aside.**
      `create-scenes` now owns intake end to end: `downloadVoiceover(url)` →
      `AsrPort.transcribe({audio, mime})` → `buildVoiceoverPlan()` → store the bytes at
      `ws/<workspaceId>/videos/<videoId>/audio/narration.<ext>` → **one transaction** that writes
      the plan/duration, the ordered scene rows, the audio asset, the narration row and the
      cursor advance. The transcript *is* the script: one ASR segment = one scene, first at 0,
      scene *i+1* starting exactly where *i* ends (the pause belongs to the scene that just
      spoke), last ending on `max(reported duration, last word end)`. Past `MAX_SCENES` the
      shortest adjacent pair is merged repeatedly, so every surviving cut is still a sentence
      boundary and `scenes.text` still reassembles the transcript. Image prompts come from the
      deterministic `imagePromptFor()` via `buildFixedPlan()`, and the plan records
      `adapter: heuristic` rather than pretending a model chose cuts speech already chose.
      `create-vocal` sees `voiceoverUrl` and only advances: no pair resolution, no TTS, no
      characters charged, no narration rewrite (`voice_plan.runs = []`, `pair = null`, ASR words
      in `word_timings`). Error mapping: download bad URL/scheme/extension → `invalid_request`,
      oversize → `payload_too_large` (both permanent), HTTP/network → `upstream_failed` keeping
      its retryability; ASR 422/413 → permanent `invalid_request`/`payload_too_large`, 502 →
      permanent `upstream_failed`, 503 → retryable; unordered segments, empty spans and
      overlapping word timings are permanent `upstream_failed` before anything is stored; a disk
      write failure is `internal` retryable and never opens the commit.
      Tests: `create-scenes` 21, `create-vocal` 15, `planner/heuristic` 16; downloader 13 and
      media-ASR adapter 12 unchanged and still green. `npm run gate` green at
      **94 files / 1,210 tests**; `npm run typecheck` clean. `npm run test:db` later the same day
      (Docker engine came back up) passed **9 files / 29 tests**, including
      `create-scenes.db.test.ts`: the voiceover commit wrote the plan/duration, two contiguous
      scenes (0→2,700→6,400 ms), one `audio` asset with the upload's key/bytes/mime and one
      narration row whose ASR word timings and empty-`runs`/null-`pair` voice plan parse through
      `narrationRowSchema`.
      **Observed:** the decisions above hermetically, and the real Postgres commit rows.
      **Unproven:** no successful live transcription (faster-whisper still cannot install on
      Python 3.14), so the P5 3-minute upload artifact does not exist and the docs/09 item stays
      open. A full `test:db` run needed the Docker engine, which was down for the first half of
      the session.
      **Deliberately not built:** loudness normalisation and AAC 48 kHz re-encoding of the
      upload. The stored asset is the received container at its real mime; docs/04 §1b/§2 record
      this as a follow-up.

- [x] 2026-11-08 — **Kill-and-resume across a committed step: a redelivered job is `stale` and the
      workspace is charged once.**
      `apps/worker/src/steps/pipeline-resume.db.test.ts` (`test:db`) runs the real
      `create-scenes` → `create-vocal` → `create-images` → `create-captions` handlers against
      Postgres + pg-boss, with only the two network providers replaced: the offline heuristic
      planner, a fake `TtsPort` answering with a real ffmpeg-encoded MP3 and a contiguous global
      timeline, and the procedural image adapter plus real ffmpeg. After `create-images` commits,
      the same step is delivered again as pg-boss would after a crash before its ack: the video
      has already moved to `create-captions`, so the redelivery is `stale` — no asset, ledger row
      or queued job changes, and `job_event` records three `committed` plus one `stale`. The
      following `create-captions` then completes from the committed artifacts: four caption
      assets, one caption track, one render job, status `rendering`. Exactly one
      `tts`/`image`/`subtitles` ledger row exists, and the workspace balance equals the single
      sum (1000 → 944 with injected unit costs 1/5/2; units 49/1/1), so a double charge would
      have been caught. A second test double-delivers the first step and asserts one set of
      scenes and one next job.
      Tests: `npm run test:db` green at **10 files / 31 tests**; `npm run gate` unchanged at
      **94 files / 1,210 tests** (the new file is a DB test and stays out of the hermetic gate);
      `npm run typecheck` clean. Retained artifact
      `.data/artifacts/p5-resume/summary.json` + `frame-0001.png` (3,796 bytes, SHA-256
      `57dddeb5624370c8d153b31b71fa2f71b906fad526be00af66edaea9c63cfe0c`) records the scene/frame/
      caption counts, the three ledger rows, the 56-credit spend and the four `job_event`
      outcomes.
      **Observed:** redelivery → `stale` → resume, with one set of artifacts and one debit.
      **Unproven:** the same scenario under a *real* process kill (this test calls the handler
      directly after the commit rather than SIGKILLing a consumer mid-claim, so pg-boss's own
      retry bookkeeping is simulated, not exercised), and provider-backed TTS/image calls, which
      would need credentials and the media service. The P5 gate also still needs the real
      3-minute video and the 60 fps re-render.
      **Process deviation:** no red-run artifact; the test was written after the implementation
      it verifies and was green on first execution.

- [x] 2026-11-08 — **Palette correction never reports a `deltaE` above the cap it applied.**
      The first P5 gate run failed `create-images` on real procedural frames: the manifest schema
      rejected `frames[3].correction.deltaE` and `frames[9]` with "applied deltaE cannot exceed
      maxDeltaE". `correctTowardPalette` returned `magnitude * min(1, cap / magnitude)`, and at
      `magnitude = 10.599999999999978` that product rounds to `6.000000000000001` — one ULP above
      the 6 ΔE cap, on roughly 6% of clamped vectors in a 20,000-point sweep. A new test in
      `packages/core/src/style/color.test.ts` walks 512 targets and asserts every reported value
      is `<= cap`; it reproduced `expected 6.000000000000001 to be less than or equal to 6`. The
      fix is one line: `Math.min(magnitude * scale, maxDeltaE)`.
      **Observed:** red → green on the new test, `color` + `postprocess` suites 30 passed,
      `npm run gate` green at 94 files / 1,210 tests.
      **Assumed:** no other arithmetic sink exceeds its contract bound the same way; the other
      clamps were not re-swept. docs/04 §3 now says the reported value is the cap itself, not the
      rounded product.

- [x] 2026-11-08 — **P5 gate artifact: a real 2:57 Tanglish video through all five steps, with no
      fakes.**
      `scripts/e2e-video.ts` drives the production handlers (`create-scenes` → `create-vocal` →
      `create-images` → `create-captions` → `render`) against real Postgres, the real media
      service (edge-tts on `MEDIA_SERVICE_URL`) and real ffmpeg; only the HTTP API is bypassed
      (the video row is inserted directly, so no api process is needed). The planner is the
      offline heuristic and the image adapter is the procedural one because this machine has no
      provider credentials; both record their provenance in the plan/manifest. The script is a
      hand-written Tanglish explainer: 252 Tamil + 27 English words, 10 scenes.
      Observation from `.data/artifacts/p5-gate/`: container 177.466667 s, stored duration
      177,457 ms, 279 word timings, H.264 1920×1080 30/1 + AAC 48 kHz stereo, MP4 11,030,297 bytes
      SHA-256 `da19886924503fb17073cd57bdcac2ed45667f28d48526e3a961b284dc170367`; exactly one
      ledger row per action — `tts` 2,278 units at cost 0, `image` 1, `subtitles` 1, `render` 2.96
      units at 10 credits each — and five `committed` `job_event` rows with nothing else; the ASS
      carries Tamil text. Step seconds 0.0 / 23.4 / 4.3 / 0.1 / 48.1 (TTS cache hit; render is
      the cost).
      **Surprise:** the shipped wpm model disagrees with real continuous Tamil narration. The
      same script estimated 140.3 s but mastered at 177.5 s (+26.5%), and the earlier 3:51 cut
      estimated 182.2 s but mastered at 231.3 s (+27.0%) — a stable ~1.27× factor, whereas docs/04
      §1 records Tamil calibration at −1.5% mean on the sample sets. The cause is not isolated
      (sentence-final silence in a multi-paragraph master is the leading guess). Recorded in
      docs/04 §1 and **not fixed**: re-anchoring the rate changes scene packing and the
      request-duration limit, so it is its own task.
      **Still open for the gate:** the 60 fps re-render artifact, and resume under a real process
      kill.

- [x] 2026-11-08 — **Sentence pauses are compressed, so narration stops sounding like a
      lecture.**
      A listener said the voice "is not natural, too much break and stops". Measurement on the
      2:57 gate artifact agreed: 44.1 s of 177.5 s (24.9%) was silence, 34 pauses at ~0.94 s and
      32 at ~0.35 s. Cause: `compress_pauses` had one band (60–250 ms) and deliberately left
      everything longer alone, but edge-tts's ~950 ms full stop lives *inside* a run (confirmed
      on the cached run WAVs: `run-13` = 0.98 + 0.98 s), and `gap_ms_for('sentence')` then added
      another 300 ms at the run join.
      Change: a second band in `services/media/app/audio.py` — 250–1200 ms → 320 ms
      (`TTS_SENTENCE_PAUSE_MS`, `0` restores the provider break), >1200 ms left as a paragraph
      beat; `Stitcher` passes it through, `main.py`/`config.py` read the env. `PauseCut` and
      `_compact()` needed no change, so the caption invariant is untouched by construction.
      Tests: `test_pauses.py` now covers 900 ms → 320 ms, the 350 ms band boundary, a 1400 ms
      paragraph guard, mixed bands in one file and the disable switch; `test_stitch.py` adds a
      900 ms case asserting every later word moves by exactly the removed frames. Red first:
      `ImportError: cannot import name 'PAUSE_SENTENCE_KEEP_MS'`, then
      `assert 960 == 1540 - 580` on a wrong expectation in my own test (fixed, not the code).
      `python -m pytest` green (3 pre-existing ASR skips), `ruff` clean.
      **Observed A/B** on the first nine runs of the real master (identical text): old 54.59 s /
      20.3% silence / 9 pauses ≥ 600 ms → new 48.68 s / 10.6% / none, speech time unchanged at
      43.5 s. Artifacts `.data/artifacts/p5-pacing/{old,new}.mp3`, measured with
      `silencedetect=noise=-35dB:d=0.20`.
      **Unproven:** "natural" is the user's listening verdict, not mine; the full 3-minute
      artifact has **not** been re-rendered on the new policy yet (deliberately: listening
      gate first), so `.data/artifacts/p5-gate/` still holds the older, pause-heavy audio.

- [x] 2026-11-08 — **One sentence is one provider call, not one call per language switch.**
      Follow-up to the pause fix: even with the 320 ms beat, `நான் online தொழில் செய்கிறேன்` was
      sent as three `/synthesize` segments and came back as three stitched clips — three 5 ms
      fades, three prosody resets, a seam at every English word. Cause: `planToSegments()`
      forwarded the segmenter's language runs 1:1, but a run boundary is a spelling boundary, not
      a speech boundary, and every shipped pair is **one** speaker reading both languages.
      Change: `planToSegments()` merges adjacent runs that share a voice and whose previous text
      does not end at `.!?।…` (trailing closers allowed). A full stop that ends a run still starts
      a new call, so merging never cuts a sentence; the provider's own sentence pause inside a
      merged stretch is what the 320 ms band then compresses.
      Tests (red first, then green): `plan.test.ts` — one speaker reads
      `நான் online தொழில் செய்கிறேன்.` as one segment; `நான் online. நன்றி.` still splits into two;
      two different voices never merge; and `segments.join(' ') === plan.spokenText`, so merging
      cannot change a word. `npm run gate` green at **94 files / 1,215 tests**.
      **Observed:** the 12-scene gate script is **28 runs → 13 calls** (five scenes merged);
      the 48 s A/B `.data/artifacts/p5-pacing/stretch.mp3` sends the same text as 3 calls instead
      of 9 with the silence share unchanged (10.7%): the seams are gone, the pauses are not.
      **Re-measured end to end** — the pause fix had made the previously trimmed script 145.4 s,
      which failed the 150 s gate floor, so the cut paragraphs were restored: **176.03 s**, 12
      scenes, 318 word timings, H.264 1920×1080 30/1 + AAC 48 kHz stereo, MP4 11,863,752 bytes
      SHA-256 `f9da937d32ece76ade428357d14515081e7d49c73a5ea0ff7e3d95229b4f49b4`; one ledger row
      per action (`tts` 2,739 units at 0, `image` 1, `subtitles` 1, `render` 2.93 at 10 credits)
      and five `committed` events. Against the old 2:57 artifact: silence 44.1 s / 24.9% → 26.4 s
      / 15.0%, pauses ≥ 600 ms 34 → 0, and 56 more words spoken in about the same runtime.
      **Unproven:** the user's ear on `stretch.mp3` and the new `p5-gate/video.mp4`; `sample-tts`
      labels provider calls as "runs", so regenerated sample tables would read lower.

- [x] 2026-11-08 — **P5 gate: the 3-minute video re-renders at 1080p/60 without losing its
      30 fps copy.** `scripts/e2e-video.ts --rerender` now runs the five production handlers,
      then the production transition (`createQueueRender` → `beginRender` + enqueue on one
      Postgres transaction) and the real `render` handler again. While the cursor is
      `rendering`/`render` the old `videoUrl` is unchanged; the second run writes new
      `render-1080p-60-standard.mp4` and `thumbnail-1080p-60-standard.png` keys, appends a
      second `render` row, adds one `action=render` ledger row at the doubled `unit_cost=20`,
      writes a sixth `committed` `job_event`, and returns `status=completed`/`step=null`.
      Test: `steps/render.db.test.ts` gained a real Postgres + ffmpeg case on the 2 s seed —
      two render rows (30/60), the 30 fps file byte-identical, the 60 fps probe `60/1`, and
      charges of 10 and 20 credits. `npm run test:db` **10 files / 32 tests**; `npm run gate`
      **94 files / 1,215 tests**; `pytest services/media` **124 passed, 3 LIVE skipped**; ruff
      clean.
      Artifact `.data/artifacts/p5-gate/`: 30 fps `video.mp4` 12,796,401 bytes SHA-256
      `714a2bd9e5966f055b62ba985afc34790e239ac48de567382c2cb27517cb0042` (3:04.27, 12 scenes,
      334 word timings); 60 fps `video-60fps.mp4` 14,565,011 bytes SHA-256
      `75f3736620b96c40b9c10f2aa32478659e16e4e52b1dc7ebef808834e2e2376c`, H.264 1920×1080
      yuv420p **60/1** (11,056 frames) + AAC 48 kHz stereo, same 184,263 ms;
      `thumbnail-60fps.png` 46,214 bytes SHA-256
      `e1db07af7ce8c83606ab11608c3ab659662c6cb3f6e1cb8069590c8332cc3d5d`. Ledger: `tts`
      2,739 @ 0, `image` 1 @ 0, `subtitles` 1 @ 1, `render` 3.07 @ 10, `render` 3.07 @ 20; six
      `committed` events; step seconds 0.1 / 55.0 / 22.3 / 0.1 / 128.8 / 207.3. Frames at
      0.4 s / 92 s / 120 s were opened: Tamil clusters are intact and the karaoke colour is on
      the spoken word.
      **Observed:** the real transition, the second MP4/thumbnail, the unchanged 30 fps bytes,
      the doubled charge and the terminal cursor. **Unproven:** a resume under a real process
      kill is now the only open P5 gate item.
      **Surprise:** the same 12-scene script estimated 169.2 s and mastered at 184.3 s (+8.9%),
      not the ~27% overshoot docs/04 recorded; those +27% runs predate the 320 ms sentence-pause
      band. docs/04 §1 was corrected here without changing the rate model (the 176.0 s run from
      the previous entry is the +4.0% end of the same spread).
      **Process note:** the new DB test was green on first execution because the re-render path
      already existed; no red-run artifact. Running the full gate on this loaded desktop exposed
      a pre-existing flake: `image/postprocess.test.ts` walks ~590k pixels per case and exceeded
      Vitest's 5 s default only when the 94-file suite ran in parallel. Fixed with a file-level
      30 s timeout (test-only, no behaviour change); the case still takes ~2.9 s alone.

---

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-11-05 | Use multiple public references when a FacelessPro behaviour or UX decision is unclear; no single product is the blueprint, and committed specs stay authoritative | comparing independent evidence reduces accidental cloning and exposes trade-offs; the resulting design must be original and any scope/contract change is written into the spec first |
| 2026-11-02 | Docs de-anonymized from any third-party product: names and hosts replaced with neutral wording, "parity" reworded to "committed behaviour/compatibility", copy-guardrails generalized | the docs stand on their own spec; behavioural content unchanged |
| 2026-10-26 | Keep `@stickman/*` code, rename scope in P0 | it is real prior work (segmenter + edge-tts + fonts), not scaffolding |
| 2026-10-26 | pg-boss over Redis/BullMQ | ledger + job state must commit in one transaction |
| 2026-10-26 | Raw ffmpeg + ASS before Remotion | deterministic output, 4K without Node memory, ASS gives per-word karaoke |
| 2026-10-26 | TTS before any visual work | it is the differentiator and the riskiest quality problem |
| 2026-10-26 | Cloudflare Workers AI as default free engine | user has it; covers planner + images + VLM with one credential |
| 2026-10-26 | No LoRA in v1 | style locking by description + palette + character bible is enough to test the product; LoRA needs GPU and is a P10 upgrade |
| 2026-10-26 | Webhooks signed by default | the base contract allows unsigned, security requires signed — signed default, opt-out for compatibility |
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
| 2026-10-31 | Pollinations uses the current authenticated endpoint; the legacy keyless host is not a fallback | live evidence: current `/image` returns 401 without a key, while legacy `/prompt` returns an image with a visible provider watermark even when `nologo=true`; FacelessPro will not remove a provider mark, and procedural still guarantees zero-key completion |
| 2026-10-31 | ComfyUI takes an operator API-format workflow and output node; timeouts never call global `/interrupt` | SDXL, Flux and custom-node graphs are not interchangeable, so five typed placeholders adapt any exported graph without guessing node ids; `/interrupt` can cancel unrelated local work, while the worker's own retry/idempotency layer owns recovery |
| 2026-10-31 | An image adapter skipped for missing config is a warning, not `degradedFrom`; the chain **overwrites** provenance | degradation must mean a provider was tried and failed, otherwise `degradedFrom` becomes noise from unset keys; direct adapters cannot see earlier failures, so merging their own empty list would erase the chain's history |
| 2026-10-29 | `POST /v1/art-styles` upload endpoint | multipart upload with ffprobe validation (≥30s, has audio, ≤10min), stores file, inserts `art_style` row with `status='building'`, returns `202`. No auth yet (P6); build job enqueued in follow-up. 8 contract + 9 API tests (mock ffprobe). Artifact: fake video → 202, row inserted, file written. Surprise: `Object.defineProperty` on `File.size` doesn't work in Node — the 500 MB limit test was dropped rather than faking a large file. |
| 2026-10-30 | Frame sampling with scene detection | ffmpeg `select='gt(scene,0.3)',showinfo` for scene changes, 3 evenly spaced frames, dedup within 1s, cap 24 (prefer high-scoring scenes), min 8 frames. Saves PNG to `storage/frames/<artStyleId>/`. 8 unit tests mocking ffmpeg/ffprobe. Artifact: 5 scenes + 3 spaced → 8 frames, dedup/cap/error handling verified. Surprise: mocking `readdir` with correct `Dirent<NonSharedBuffer>` type required careful typing; the real `readdir` returns strings by default but TS sees `Dirent[]`. |
| 2026-10-30 | Numeric analysis: palette + ink + tone + safe area | `packages/core/src/style/palette.ts` (farthest-point k-means, no RNG, weighted hex palette) and `stats.ts` (`lineStats`, `saturationStats`, `contrastStats`, `brightnessStats`, `safeAreaStats`, `percentile`); `apps/worker/src/art-style/frame-decode.ts` turns a PNG into RGB24 via ffmpeg `-f rawvideo` (no PNG dependency, no upscaling); `numeric-analysis.ts` averages line/tone across frames but computes ONE palette over all of them, then parses through `numericStyleProfileSchema`. 12 contract + 20 core + 16 worker tests. Artifact (real ffmpeg 9.0.2 on a synthetic 40 s, 4-scene clip): palette `#f1bf4d 37.5%, #1a283f 36.1%, #fefefe 20.8%, #020202 4.1%, #e2562d 1.4%` against painted `#f2c14e, #1b2a41, #ffffff, #000000, #e4572e`; weights reconcile to the frame composition (3 yellow frames, 3 navy, 2 white plus a bar and a rectangle). Surprise: the real run exposed the frame-sampling defect below, which every mocked test had missed. |
| 2026-10-30 | Frame sampling detector was silently returning zero cuts | `showinfo` no longer prints `scene_score` in current ffmpeg, so `select=gt(scene,0.3),showinfo` parsed an empty list and the sampler silently fell back to spaced frames only; `-v error` hid the log lines as well. Replaced with `scdet=threshold=30` read at `-v info` (score/100), and a reference with fewer than eight cuts is now padded with evenly spaced frames instead of rejected. Verified on real ffmpeg: cuts at 10.00 s (0.52) and 30.00 s (0.59) captured; the 10->20 s cut scored 0.28 and was left to the spaced frames. Lesson recorded in docs/04: a mocked subprocess test cannot prove a parser matches the tool. |
| 2026-10-30 | Vision pass: `STYLE=cloudflare,gemini,heuristic` | `packages/contracts/src/style-vision.ts` defines `styleVisionAnswerSchema` (model fields only) and `styleVisionSchema` (answer + `adapter`/`degradedFrom`). `apps/worker/src/art-style/vision/` adds `prompt`, `parse`, `frames` (6 frames, 384 px long edge, base64 JPEG), `cloudflare`, `gemini`, `heuristic`, `chain`, `factory`. `STYLE=vlm,heuristic` was a placeholder provider name and is replaced everywhere (.env.example, docs/03 section 7, docs/06 section 1.5). Two deviations, both documented: vision answers **strip unknown keys** instead of rejecting them (models volunteer `palette`/`line.color`; an invalid enum is still fatal), and `UpstreamError.adapter` widened from `PlannerAdapter` to `string` so the style chain reuses `planner/http.ts` without copying its retry taxonomy; planner behaviour is unchanged. 16 contract + 69 worker tests, gate 50 files / 734 tests. Artifact on the real 8 frames (heuristic path): medium unknown, thin outlines, flat colour areas, simple background, low edge content, no characters, no typography -- every clause traceable to a measured number. **Unproven:** Cloudflare/Gemini description quality; no credentials locally, so both adapters are tested against recorded HTTP shapes only. |
| 2026-10-30 | StyleProfile merge: measured palette + described style | `packages/contracts/src/style-profile.ts` adds the merged document (`version: 1`, top-level palette, `measured` block, `source` adapter/degradedFrom, `line.color` must appear in `palette.hex`); `style-vision.ts` now exports the character/typography schemas with their cross-field rules so the profile reuses them instead of copying them. Pure `lineColorFor` (darkest measured colour, ties keep the higher-weight entry) and `seedBaseFor` (FNV-1a over prompt-relevant fields, palette hexes sorted/deduped, weights excluded) live in `packages/core/src/style/profile.ts`; the schema-validated `mergeStyleProfile` is in `apps/worker/src/art-style/merge.ts`. **Correction from the plan:** the merge could not live in core because `packages/core` is dependency-free (no contracts import) and lint enforces it; core keeps the pure helpers, worker owns the boundary. The numeric profile test was renamed `numeric-style-profile.test.ts` so `style-profile.test.ts` could test the merged shape. 14 contract + 8 core + 9 worker tests; gate 53 files / 765 tests. Artifact (real 8 frames + heuristic vision): ink `#020202` (in palette), seed `676166201` stable on a second run, `measured` keeps tone/aspect/safeArea/frameCount, `source` heuristic/empty, schema-valid. **Not proven:** previews or image consistency; nothing is generated yet. |
| 2026-10-31 | Palette correction is one bounded LAB translation, not a nearest-colour remap | a per-pixel remap posterises the model's shading into flat fills; a single ≤6 ΔE vector moves the whole still toward the palette while preserving internal contrast, and it is cheap enough to run on every scene |
| 2026-10-31 | Consistency uses a **soft** RGB histogram, strict-`>` threshold, nearest accepted scene | hard bins made visually identical scenes differ by 0.885 when one channel sat a byte either side of a 128 edge — a false outlier would spend a provider call; soft tri-linear bins measure colour distribution rather than byte boundaries, and nearest-neighbour means one unusual hero scene cannot veto every later frame |
| 2026-10-31 | The quality guard regenerates **once** and accepts the second result even if it is still an outlier | a guard that retries until consistent can spin against an uncooperative provider; one bounded retry keeps the cost predictable, and the manifest records the `regenerated` flag so the still-outlier case is visible rather than hidden |
| 2026-10-31 | Python runtime pins match the versions the suite has actually run against | the deleted `requirements.txt` named fastapi 0.162/pydantic 2.14 that no local run ever installed; a pin nobody has executed is an assumption, and CI should test the environment the gate uses |
| 2026-10-31 | `GET /v1/art-styles` omits `failed` as well as `building` | an id returned by the list is handed straight to `artStyleId`; a failed build has no usable profile, so listing it only produces a guaranteed 409/500 later |
| 2026-10-31 | The export is `{version, name, formats, profile}` only, with the profile re-validated | the document must import on another machine, so ids, storage keys, preview URLs and timestamps are local facts; re-validating the jsonb means a corrupt row is a clear `500 internal` instead of a half-export the importer must guess about |
| 2026-10-31 | Storage keys become `/files/<key>`; absolute URLs pass through | one public prefix to rewrite when a CDN replaces the api's static route (P6), and an absolute provider URL is already a public URL and must not be prefixed |
| 2026-10-31 | `sampleVideoUrls` accepts a path, not only a URL | the list route maps preview and sample keys through the same storage helper; the artifact proved `z.url()` turned any non-empty local sample key into a plain-text 500 |
| 2026-10-31 | `app.onError` returns the error envelope, not Hono's plain text | the rule is that every user-facing failure has a `code`; a fixed `internal` message keeps SQL/paths/stacks out of the response while the real error is logged |
| 2026-11-01 | AGPL-3.0 for our code, DCO for contributions, squash-merge by the maintainer | copyleft is the only licence that stops a hosted fork becoming a closed competitor; DCO keeps contribution friction near zero at the cost of not being able to relicense later; squash keeps `development` one commit per roadmap task, which is what the gate and `PROGRESS` are written against |
| 2026-11-02 | Relicensed AGPL-3.0 → MIT | sole-maintainer relicence; concrete trigger: an open code-reuse index asked for a permissive reuse of one commit; trade-off accepted: a fork may be hosted closed-source, recorded in docs/11 §0; DCO unchanged |
