# 09 — Roadmap

Ordered work. One task at a time, code → test → next.
Every phase has a **gate**; a phase is not started until the previous gate is green.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## P0 — Foundation

Goal: the repo can build, migrate, queue and serve, with the new name and the shared contracts.

- [x] Rename package scope `@stickman/*` → `@facelesspro/*`; update `tsconfig` paths, `vitest`
      alias, workspace deps; regenerate `package-lock.json`; keep service ids consistent
      (`facelesspro-api`, `facelesspro-media`). Compose user/db renamed to `faceless` to match
      `.env.example`; the `stickman` art-style fixture keeps its name (content, not scope).
- [x] `packages/contracts`: zod schemas for every request/response in
      [01](./01-product-spec.md) §3–§9, plus DB row types. 48 tests, three files:
      `requests` (all templates + defaults + cross-field rules), `transport` (errors, webhooks,
      media-service and timeline shapes), `db` (one row per table). Limits and enums live in
      `common.ts` so api, worker, web and mcp cannot disagree.
- [x] `packages/core` public API surface (barrel `index.ts`) — no behaviour change yet.
      Already present and complete (`plan.ts` and `numbers.ts` were exported when they landed);
      verified rather than rewritten.
- [x] Postgres + Drizzle: schema from [03](./03-architecture.md) §3, migration runner
      (`npm run db:migrate`), seeded built-in caption templates + a `selfhost` dev workspace.
      **Plans are code, not rows** ([03](./03-architecture.md) §3 has no plan table), so
      "seeded plans" was wrong wording and is corrected here rather than faked with a table.
      17 tables, one committed migration, `schema.test.ts` (table/column/enum parity with the
      contract rows) + `timestamp.test.ts` + `client.test.ts` (20 tests).
      Verified by running it: migrate twice → `17 tables, 1 migrations applied, 3 new templates`
      then `0 new templates`; a drizzle insert→select round-trip parses through
      `videoRowSchema`.
- [x] pg-boss wiring: `enqueue`, `consume`, `withStep` helper (idempotency + lock + ledger tx).
      One queue per step, named after the step id, so the queue vocabulary cannot drift from
      `video.step`. `withStep` claims under a row lock, fences the commit with
      `job_lock.attempt`, and gives the body exactly one commit handle (`charge`, `enqueue`,
      `advance`). Verified against real Postgres: 14 integration tests (`npm run test:db`)
      including rollback-after-enqueue and two concurrent jobs running the body once, plus 12
      hermetic tests for names/payload/policy. `test:db` is deliberately outside the gate.
- [x] `apps/worker` skeleton with a no-op `ping` step; `apps/api` `/health` reports db + queue.
      `ping` is its own queue (`retryLimit: 0`), not a `video.step`: the step tuple is a public
      contract and a smoke test must not widen it. `startWorker({ boss })` consumes it through
      `consume()`, and `stop()` calls `offWork` so Ctrl-C drains instead of abandoning a job.
      Pipeline step handlers land in P5; until then a step job stays queued rather than being
      failed by a handler that does not exist.
      `/health` runs two injected probes under a 2 s deadline each: `select 1` for db, and
      `checkQueues()` for the queue — which reads pg-boss's own `queue` table and requires all
      five step queues plus `ping`, because "TCP connect worked" cannot see a missing queue.
      `200 {status:"ok", db:"ok", queue:"ok"}` / `503 degraded` with the failing component
      named. Body is `healthSchema` from `@facelesspro/contracts`. `media`/`storage` join the
      shape when those ports exist. `npm run ping` enqueues and polls until completed, so the
      artifact check is an exit code.
- [x] `npm run gate` script; eslint import boundaries; `.env.example` rewritten.
      `gate = typecheck && lint && test`; eslint 10 + typescript-eslint 8, flat config, no
      type-aware rules (so it stays ~2 s). Boundaries are rules, not prose: `core` may import
      only relative files and may not touch `Date`/`process`/`fetch`/`Math.random`; `contracts`
      may import `zod` only; no package imports an app; no deep `@facelesspro/*/src/*` imports;
      the api/worker may not import `pg-boss` (the api not `pg`/`drizzle-orm` either).
      `test:unit`/`test:contract` were **not** created: one `test` suite runs everything
      hermetic, and the split becomes a vitest project when a suite needs different isolation
      ([08](./08-testing.md) §2 says so).
      `.env.example` rewritten: ASCII section banners, no trailing-comment traps, `PGBOSS_SCHEMA`
      documented, `FONTCONFIG_FILE` commented until P4 ships the config, script/test knobs
      (`PYTHON`, `TTS_PORT`, `TTS_PAIR`, `TTS_OUT_DIR`, `RUN_LIVE`) listed.
- [x] CI workflow: gate + pytest on push.
      `.github/workflows/ci.yml`, two jobs: `gate` (node 22 — the `engines` floor — with
      `actions/setup-node` npm cache, `npm ci`, `npm run gate`) and `python` (3.12 per plan.md
      §5, pip cache keyed on `services/media/requirements*.txt`, `apt-get install ffmpeg`,
      `ruff check app tests`, `python -m pytest`). `permissions: contents: read`,
      `concurrency: ci-${{ github.ref }}` cancels a superseded run, `workflow_dispatch` for
      manual runs. `test:db`, `test:live` and `sample:tts` stay out, as
      [08](./08-testing.md) §2 requires. No branch filter: pushing any branch runs it.

**Gate:** `docker compose up -d && npm run db:migrate && npm run gate` green from clean clone;
`/health` shows `{db:"ok", queue:"ok"}`.

Status 2026-10-27: every task above is done and the gate + `/health` + `npm run ping` were
observed locally against compose Postgres. P0 is not formally closed until the workflow runs
green on the remote — that needs a push, not more code.

**Artifact check:** enqueue `ping`, watch it complete in the DB.

---

## P1 — Tamil + English mixed narration  ⭐ the reason this project exists

Goal: narration that sounds like one bilingual person. Details: [05](./05-tts-tamil-mixed.md).

- [x] `packages/core/data/tanglish.json` lexicon (651 entries) + loader + version field.
- [x] Morphological heuristic for inflected Tanglish (`veetukku`, `pannunga`, `irukkanga`).
- [x] Inline overrides `[[ta:…]] [[en:…]] [[tl:…]]`.
- [x] `transliterate.ts` + dictionary-first golden table (442 dictionary entries, 428 of 647 routed words pinned; 68 tests).
- [x] `numbers.ts` language-aware expansion (2024 / ₹500 / 3pm / 50% / 1,20,000; 103 tests).
- [ ] **deferred after P1** — Tamil numeral sandhi for glued case suffixes (`2024-ல்` →
      `…நான்கில்`, `50%க்கு` → `…சதவீதத்திற்கு`); needs its own listening test, see
      [05](./05-tts-tamil-mixed.md) §3.6. Not part of P1 acceptance: no gate clip exercises it.
- [ ] **deferred after P1** — Latin stem + Tamil suffix keeps a dangling hyphen: `channel-க்கு`
      reaches the engine as `channel- க்கு` (found 2026-10-27 on a fresh sentence). Measured
      effect: none — the engine splits at the hyphen and the word gap is 42 ms, like every other
      boundary — but captions and the spoken text still carry the dash, so the normaliser (drop
      the hyphen, glue the suffix) belongs with the sandhi work.
- [x] Voice catalogue with capability tags (`languages`, `mixesEnglish`, `wordTimings`),
      pinned ids, a test that fails if a voice disappears — `services/media/app/voices.py`,
      15 voices, `test_voices.py` (31 tests) + 3 live tests (`RUN_LIVE=1`).
- [x] Voice pairing: **one speaker per pair** (`valluvar` male default, `pallavi` female default,
      `seraphina`, `vivienne`, `thalita`, `andrew`, `emma`, `ava`, `indicf5-ta`, `piper-offline`).
      Every female voice that passed the fresh sentence is a pair, not a catalogue entry: four
      selectable women, ten pairs in total. `validate_pair` rejects a second
      voice whenever the Tamil voice can already read English, so the two-speaker configuration
      the listening gate rejected cannot be built; `ta-LK` voices stay catalogued but unpaired,
      and `test_both_genders_ship` fails if every female pair is ever removed.
- [x] Media service: gap calibration by boundary class, per-run loudness (`loudnorm`), 5 ms
      equal-power cross-fade, silence trim, exact global word offsets — `stitch.py`/`audio.py`/
      `boundaries.py`, 91 pytest tests. Speed-scaling of gaps is implemented but not exposed:
      `speed` arrives with `voiceStyle` at P4. Program stage added: peak-bound runs are fixed on
      the assembled master (−16.28…−16.46 LUFS, TP ≤ −1.79 dBTP, frame-exact).
- [x] Internal word-pause compression (`audio.compress_pauses`, `TTS_PAUSE_COMPRESSION`): the
      provider's 60–250 ms silences *inside* a run are cut to 50 ms with 25 ms of guard at each
      edge, sentence breaks untouched, and words are moved by exactly the removed frames.
      Measured on clip 01: 10.34 → 9.99 s, 13 × 65–175 ms gaps → 11 × 50 ms. 15 new tests.
- [x] Cache: `hash(engine, voice, text)` → raw provider audio + words
      (`services/media/app/cache.py`, 13 tests). Atomic two-file entries, bounded oldest-first,
      `GET /cache`. Observed cold 2.15 s → warm 0.48 s with identical duration and words.
- [x] `npm run sample:tts` → 7 clips per pair, the seventh written after the voices were chosen
      (`07-fresh-mixed.mp3`, the sentence that demoted `emma`). One directory per pair, named
      after the pair id (`sampleSetDir`): male set in `samples/tts/valluvar/` (`valluvar`):
      9.90 / 8.83 / 14.85 / 6.80 / 3.58 / 15.54 / 13.95 s; female set in `samples/tts/pallavi/`
      (`TTS_PAIR=pallavi`): 10.00 / 9.44 / 15.57 / 7.13 / 3.99 / 15.77 / 14.80 s. Both
      −16.26…−16.49 LUFS, TP ≤ −1.76 dBTP, one voice per clip, frame-exact. `samples/tts/README.md`
      indexes every set from its `report.json`; a set existing is not an approval.
      Heard 2026-10-27: first run **failed** on Tamil naturalness and on the speaker switch —
      see the status note below.
- [x] One canonical set per voice: `sampleSetDir()` in `packages/core` turns the pair id into
      `samples/tts/<pair>/` (validated, so a voice id or `..` cannot become a directory),
      `sample-tts.ts` derives the output from the pair instead of an env var, and
      `samples/tts/README.md` indexes every set from its `report.json`. Scratch renders live in
      `samples/tts/auditions/` and are never evidence. `samples.test.ts` (3 tests).
- [x] `GET /voices` + `GET /voices/{pair}` exposed on the media service (the sample script
      resolves its pair there instead of hardcoding ids).

**Gate:** all unit + stitch tests green; `pytest` green; **the male set and every female voice's
fresh-text clip (07) are approved**. The 01–06 clips of the four female sets were rendered for
those voices and are pending one listen — until they pass, P1 is one listen from closed, not
closed. No seam audible in `03-mixed-paragraph.mp3`; Tamil glyphs correct.

**Artifact check:** `samples/tts/valluvar/05-tanglish.mp3` — `"vanakkam machan, epdi irukka?
today we talk about money."` sounds like one Tamil speaker, not two; the same sentence in
`samples/tts/pallavi/05-tanglish.mp3` sounds like one Tamil woman, not two.

Status 2026-10-27: **P1 is one listen from closed.** The first run failed on Tamil naturalness
("not natural") and the follow-up named *gaps between words* and *the voice's timbre*. Both are
fixed: pauses inside a run are compressed (65–175 ms → 50 ms) with the words re-timed to the
frame, and the catalogue now allows only **one speaker per pair**, because the second voice was
audible as a narrator swap inside a sentence ("pair tamil and english voice are spoken with
different voice"). The clips were regenerated and measured green on loudness, duration, timeline
and voice count; the male set was approved, and the female set was approved with a voice that
later failed on fresh text — hence the re-open below.

The female line stays in the catalogue and is **not** optional — a channel may want a woman
narrating. Choosing her took three rounds and one instructive failure:

1. Six fixed clips: *"emma is good saranya is not good"* → `emma` promoted, `saranya` rejected.
2. A sentence nobody had heard her on: *"valluvar is good , emma is not good"* → `emma` demoted.
3. The same sentence for every remaining female voice: *"all good"* → with no audible winner, the
   product rule decides: Tamil is the primary language, so `pallavi` (`ta-IN-PallaviNeural`, native
   `ta-IN`, Indian-accented English like Valluvar) is the female default and `TTS_PAIR=pallavi`
   selects it. `emma`, `ava` and `saranya` stay catalogued — two as rejected timbres, one unpaired
   — because rejecting a voice is not deleting the option. `en-GB-AdaMultilingualNeural` is
   unusable: listed by `edge-tts --list-voices` but `NoAudioReceived` for every synthesis.

The three women who also passed that sentence are pairs, not table entries: `seraphina`
(`de-DE`), `vivienne` (`fr-FR`) and `thalita` (`pt-BR`) are selectable with `TTS_PAIR=<id>`, so a
channel picks its narrator rather than accepting ours. Ten pairs in total, fifteen voices.

The gate now renders seven clips, not six: `07-fresh-mixed.mp3` is written after the voices are
chosen, so a voice cannot be approved on text it happened to suit.

The full female set is rendered next to the male one rather than over it:
`TTS_PAIR=pallavi npm run sample:tts` → `samples/tts/pallavi/`, seven clips at 10.00 /
9.44 / 15.57 / 7.13 / 3.99 / 15.77 / 14.80 s, −16.26…−16.49 LUFS, TP ≤ −1.76 dBTP, one voice per
clip, frame-exact. Her clip 07 passed by ear; 01–06 of every female set are the last listen
between this phase and a close.

Each option voice has its own seven-clip set in `samples/tts/{seraphina,vivienne,thalita}/`
— 21 clips, one voice each, frame-exact, −16.22…−16.36 LUFS, TP ≤ −1.75 dBTP. Their fresh clip
runs 12.65 s (Vivienne), 13.26 s (Thalita) and 15.88 s (Seraphina) for the same text.

If a timbre is rejected later, the remaining lever is a different engine (paid Azure/ElevenLabs
or GPU IndicF5), which needs its own decision.

---

## P2 — Scene planner

- [ ] `PlannerPort` + adapters: cloudflare, groq, ollama, heuristic.
- [ ] Prompt contract: strict JSON, scene count bounds, char budget, per-scene image prompt.
- [ ] Repair loop (one retry with a diff) → deterministic fallback.
- [ ] Sentence splitter handling Tamil + Latin terminators and abbreviations.
- [ ] `POST /v1/videos/plan` (dry run, no charge).
- [ ] Duration estimate per language (ta ≈130 wpm, en ≈150 wpm, mixed ≈140).

**Gate:** `fixtures/scripts/*` → stable plans; `concat(scene.text)` preserves the script;
every model down → heuristic still produces a valid plan.

**Artifact check:** plan JSON for `tamil-mixed.txt` reads sensibly, scenes are 8–20 s each.

---

## P3 — Art style + images

- [ ] `POST /v1/art-styles` (multipart reference video): probe, reject <30 s/silent/>10 min.
- [ ] Frame sampling with scene detection (8–24 frames).
- [ ] Numeric analysis: k-means palette, stroke density, edge energy, saturation.
- [ ] VLM pass → medium / composition / character bible / typography.
- [ ] `StyleProfile` schema + merge of numeric + VLM output.
- [ ] Preview grid + 6 s preview clip; `status=ready` only when previews exist.
- [ ] `ImagePort` + adapters: cloudflare flux-schnell, pollinations, comfyui, procedural.
- [ ] Palette colour correction + per-scene consistency check + one-shot regenerate.
- [ ] `GET /v1/art-styles[/:id/export]`.

**Gate:** build a style from a 2-minute reference; 6 new scenes look like the same channel to
my eye; portrait + landscape both render; rejected inputs give clear 400s.

**Artifact check:** `preview.png` grid next to real frames from the reference video.

---

## P4 — Captions + render

- [ ] Caption cue builder (word limits, line limits, Tamil grapheme safety, punctuation priority).
- [ ] ASS writer with karaoke `\k` spans + bundled Noto Sans / Noto Sans Tamil.
- [ ] Caption templates (≥6 built-ins, negative ids) + `GET /v1/caption-templates`.
- [ ] Emoji sprinkling (allow-list, opt-in, ≤1 per 2 cues).
- [ ] ffmpeg composer: stills → `zoompan` clips → concat → audio → burn subs → mux.
- [ ] `format=greenscreen` variant; `frameRate` 30/60; 1080p/2K/4K.
- [ ] `srt` / `vtt` / `ass` / `json` caption exports.
- [ ] Thumbnail extraction.

**Gate:** Tamil glyph golden-frame test green; duration within 100 ms; determinism test green;
a 60 s video with correct Tamil captions plays.

**Artifact check:** watch the 60 s render — captions land on the spoken word, Tamil shapes
correctly, no audio/video drift at the end.

---

## P5 — V3 pipeline end to end

- [ ] Steps: `create-scenes`, `create-vocal`, `create-images`, `create-captions`, `render`.
- [ ] Idempotency + lock + per-step ledger tx.
- [ ] Retry-from-step endpoint/behaviour; artifacts preserved.
- [ ] `GET /v1/videos/:id` with `status`/`step`/`error`/`videoUrl`.
- [ ] `POST /v1/videos/:id/render` with 409 guard.
- [ ] `voiceoverUrl` intake: download caps, ASR transcript, narration = uploaded audio.
- [ ] `job_event` observability rows.

**Gate:** a real 3-minute mixed-language video completes; kill-and-resume test passes with no
double charge; re-render at 60fps works; a `failed` job resumes at the right step.

**Artifact check:** the 3-minute video, end to end, from a Tanglish script I wrote by hand.

---

## P6 — API v1, keys, credits, webhooks

- [ ] API key create/list/revoke (hash at rest, show once).
- [ ] `withWorkspace()` middleware + rate limits.
- [ ] All `/v1/*` routes from [07](./07-api-and-mcp.md) §2 with the documented defaults.
- [ ] Credits: plans, ledger, `402` in paid mode, `selfhost` unlimited mode.
- [ ] Webhook delivery queue, retry schedule, HMAC signing, dedupe header, SSRF guard.
- [ ] Libraries: voices, art-styles, caption-templates, background-videos, sound-effects, files.
- [ ] `POST /v1/text-to-speech` (mixed-aware).

**Gate:** contract tests green; a script using only `curl` creates a video and receives a
webhook; revoked key → 401 everywhere; delivered webhook verifies with the HMAC secret.

**Artifact check:** `docs/examples/curl.sh` runs top to bottom against a local server.

---

## P7 — MCP server

- [ ] `/mcp` Streamable HTTP with JSON-RPC 2.0 + SSE.
- [ ] Tool registry generated from the route table (so 1:1 parity is enforced by a test).
- [ ] OAuth: metadata endpoints, DCR, PKCE S256 authorize/consent, token, refresh rotation, revoke.
- [ ] Static bearer fallback for header-only clients.
- [ ] Tool errors as text, not protocol errors.
- [ ] Extra tools: `plan_video`, `preview_script_split`, `list_languages`.

**Gate:** MCP Inspector connects; a real client (Claude Code) creates a video via
`create_ai_video_v3`; OAuth flow completes from a cold client with only the URL.

**Artifact check:** a recorded client transcript: `list_art_styles` → `create_ai_video_v3` →
`read` → `videoUrl`.

---

## P8 — Web app

- [ ] Landing (own copy + own artwork) with template gallery + pricing page.
- [ ] Auth (magic link or GitHub OAuth), workspace switcher, settings, API keys page.
- [ ] Studio: script box (Tamil/English/Tanglish), style picker, size, voice pair, cost preview.
- [ ] Job view: live step progress, error panel, retry.
- [ ] Editor: scene list, redraw, script edit → selective re-narrate, caption style preview,
      waveform timeline, render panel.
- [ ] Voice-plan inspector (which runs went to which voice + override).
- [ ] Downloads + share link.

**Gate:** Playwright studio + editor specs green; axe has no critical violations; the whole
flow works at 375 px width.

**Artifact check:** screen recording of script → finished video without opening a terminal.

---

## P9 — Remaining templates

- [ ] AI Video V2 (16 image styles, `smooth`/`strong-swipe` transitions).
- [ ] Quiz video (`standard`, `multi-levels`, comments, question images).
- [ ] Fake Text video (9 skins, group chats, `autoSplit`, per-character voices, Tinder match line).
- [ ] Roblox Rant (`voicePitch`, `captionWordLimit`, emoji, gameplay background).
- [ ] Caption video (upload ≤500 MB / ≤2 h, ASR → burn).
- [ ] Background video + sound effect libraries (CC0 assets, credited).

**Gate:** one e2e test per template; each produces a watchable 30 s video.

---

## P10 — Premium extras

- [ ] Image animation (Ken Burns first; SVD/AnimateDiff behind a flag if GPU exists).
- [ ] Avatar video + lip-sync 720p (Wav2Lip/MuseTalk behind a flag).
- [ ] 2K/4K render profiles + resolution gating by plan.
- [ ] Team collaboration: members, roles, shared workspace, seat limits.
- [ ] Per-style LoRA training hook (optional accelerator).
- [ ] Background music with ducking; SFX placement.

**Gate:** each extra has an e2e + a quality check; nothing becomes a hard dependency on GPU.

---

## P11 — Launch

- [ ] Docker images for api / worker / media / render / web; one compose file.
- [ ] Migrations on boot, health checks, graceful shutdown.
- [ ] Limits: max minutes, max concurrent jobs, storage quota, per-plan caps.
- [ ] Monitoring: structured logs, job dashboard, alert on failure rate.
- [ ] Docs site (public API + MCP, generated from the same specs).
- [ ] `THIRD_PARTY_NOTICES.md` + licence audit of every model/font/asset.
- [ ] Resolve the edge-tts licensing question ([11](./11-legal-and-compliance.md)).
- [ ] Backups + restore drill.

**Gate:** a fresh machine goes from `git clone` to a working video in < 15 minutes; restore
drill succeeds; licence audit signed off.

---

## Post-launch / optional

- Affiliate programme, cash balance, top-ups (Stripe).
- Marketplace for community styles.
- Mobile share targets / PWA.
- Batch API (create 20 videos from a CSV).
- Scheduled series (one episode per day from a story bible).
