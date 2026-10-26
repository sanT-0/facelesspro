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
- [ ] `apps/worker` skeleton with a no-op `ping` step; `apps/api` `/health` reports db + queue.
- [ ] `npm run gate` script; eslint import boundaries; `.env.example` rewritten.
- [ ] CI workflow: gate + pytest on push.

**Gate:** `docker compose up -d && npm run db:migrate && npm run gate` green from clean clone;
`/health` shows `{db:"ok", queue:"ok"}`.

**Artifact check:** enqueue `ping`, watch it complete in the DB.

---

## P1 — Tamil + English mixed narration  ⭐ the reason this project exists

Goal: narration that sounds like one bilingual person. Details: [05](./05-tts-tamil-mixed.md).

- [x] `packages/core/data/tanglish.json` lexicon (651 entries) + loader + version field.
- [x] Morphological heuristic for inflected Tanglish (`veetukku`, `pannunga`, `irukkanga`).
- [x] Inline overrides `[[ta:…]] [[en:…]] [[tl:…]]`.
- [x] `transliterate.ts` + dictionary-first golden table (442 dictionary entries, 428 of 647 routed words pinned; 68 tests).
- [x] `numbers.ts` language-aware expansion (2024 / ₹500 / 3pm / 50% / 1,20,000; 103 tests).
- [ ] Tamil numeral sandhi for glued case suffixes (`2024-ல்` → `…நான்கில்`, `50%க்கு` →
      `…சதவீதத்திற்கு`); needs its own listening test, see [05](./05-tts-tamil-mixed.md) §3.6.
- [x] Voice catalogue with capability tags (`languages`, `mixesEnglish`, `wordTimings`),
      pinned ids, a test that fails if a voice disappears — `services/media/app/voices.py`,
      9 voices, 35 pytest tests (3 live, skipped without `RUN_LIVE=1`).
- [x] Voice pairing table (`pallavi-neerja`, `valluvar-prabhat`, `indicf5-ta`, `piper-offline`)
      with gender/engine/language validation; `ta-LK` voices catalogued but unpaired.
- [x] Media service: gap calibration by boundary class, per-run loudness (`loudnorm`), 5 ms
      equal-power cross-fade, silence trim, exact global word offsets — `stitch.py`/`audio.py`/
      `boundaries.py`, 91 pytest tests. Speed-scaling of gaps is implemented but not exposed:
      `speed` arrives with `voiceStyle` at P4. Program stage added: peak-bound runs are fixed on
      the assembled master (−16.28…−16.46 LUFS, TP ≤ −1.79 dBTP, frame-exact).
- [x] Cache: `hash(engine, voice, text)` → raw provider audio + words
      (`services/media/app/cache.py`, 13 tests). Atomic two-file entries, bounded oldest-first,
      `GET /cache`. Observed cold 2.15 s → warm 0.48 s with identical duration and words.
- [x] `npm run sample:tts` → 6 clips in `samples/tts/`; not yet heard.
- [x] `GET /voices` + `GET /voices/{pair}` exposed on the media service (the sample script
      resolves its pair there instead of hardcoding ids).

**Gate:** all unit + stitch tests green; `pytest` green; **I have listened to all 6 clips and
approved them**; no seam audible in `03-mixed-paragraph.mp3`; Tamil glyphs correct.

**Artifact check:** `samples/tts/05-tanglish.mp3` — `"vanakkam machan, epdi irukka?
today we talk about money."` sounds like one Tamil speaker, not two.

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
