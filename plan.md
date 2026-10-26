# FacelessPro — Master Plan

> Turn a script (or a voice recording) into a narrated, illustrated, subtitled faceless video,
> drawn in a style cloned from a reference video. **Premium+ feature parity with vsub.io,
> running entirely on free / self-hostable engines, with first-class Tamil + English
> code-mixed narration.**

- **Status:** Phase 0 — planning complete, implementation starting
- **Owner:** sanT
- **Repo:** `D:\facelessPro` (existing package scope `@stickman/*`, renamed to `@facelesspro/*` in Phase 0)
- **Working title:** FacelessPro
- **Doc index:** see [README.md](./README.md#documentation)

---

## 1. Why this project exists

Two goals, in this order:

1. **Personal use.** I want the vsub.io Premium+ workflow (script → scenes → voice → art →
   subtitles → 1080p/2K/4K export) usable by me, on my own machine, without a $199/month
   subscription, without credit anxiety, and with a narrator that actually sounds right in
   **Tamil, English, and Tanglish (Tamil words in Latin script)** — which no western TTS
   product does well.
2. **Possible public launch.** If it works well, publish it. That means it must be a real
   product, not a clone script: multi-tenant workspaces, API keys, webhooks, an MCP server,
   a usable web editor, and a licence-clean dependency chain.

**Explicit non-goal:** copying vsub.io's code, copy, artwork, templates, sample videos, or
branding. We replicate *observable behaviour* (documented in
[docs/02-reverse-engineering.md](./docs/02-reverse-engineering.md)) and build our own
implementation, our own assets, and our own copy. See
[docs/11-legal-and-compliance.md](./docs/11-legal-and-compliance.md).

---

## 2. What "Premium+" means here

vsub.io sells three tiers; Premium+ ($199/mo) sits in the middle of the paid range and is
the "most popular" one. The tier differences are **only** volume and export ceiling
(minutes/month, credits, 2K/4K unlock, team seats). The *features* are effectively tier-wide.

So "all Premium+ features" = the full product surface:

| # | Capability | Phase |
|---|---|---|
| 1 | Script → scene split (LLM, with deterministic fallback) | P2 |
| 2 | Narration: single-voice TTS + **Tamil/English/Tanglish mixed** | P1 |
| 3 | Voiceover upload → transcription (ASR) as the narration | P6 |
| 4 | Art-style cloning from a reference video | P3 |
| 5 | Per-scene image generation locked to that style | P3 |
| 6 | Word-level captions, caption templates, animated emoji | P4 |
| 7 | Timeline + ffmpeg render: 1080p / 2K / 4K, 30/60fps, 16:9 / 9:16 / 1:1 | P4 |
| 8 | Green-screen export variant | P4 |
| 9 | Scene editor: redraw one scene, edit script, re-narrate | P8 |
| 10 | Resumable pipeline + retry-from-failure, no double spend | P5 |
| 11 | Public REST API v1 (`/v1/...`), workspace API keys | P6 |
| 12 | MCP server (Streamable HTTP, OAuth 2.1 + PKCE + DCR) | P7 |
| 13 | Webhooks: at-least-once, 10 retries, 30s → ~24h | P6 |
| 14 | Credits ledger (plans, top-ups, per-action cost) | P6 |
| 15 | Template family: AI Video V3, AI Video V2, Quiz, Fake Text, Roblox Rant, Caption Video | P5, P9 |
| 16 | Libraries: voices, sound effects, background videos, caption templates, art styles, files | P6 |
| 17 | Image animation (motion on stills) | P10 |
| 18 | Avatar video + lip-sync (720p) | P10 |
| 19 | Team collaboration (members, roles, shared workspaces) | P10 |
| 20 | Affiliate / cash-balance accounting | Post-launch, optional |

Full field-level contract of each surface: [docs/01-product-spec.md](./docs/01-product-spec.md).

---

## 3. The one differentiator we lead with

Everything above can be matched with free engines. The thing that is genuinely hard, and
the reason this project exists, is **natural code-mixed Tamil narration**:

```
"இன்னைக்கு நாம பாக்கப் போறது, the biggest mistake first-time freelancers make."
        ↑ Tamil script                    ↑ English
              ↑ transliterated Tamil that must still sound Tamil, not English
```

Naive approaches fail in three distinct ways:

1. **One voice, wrong language.** A Tamil voice reads English words with Tamil phonetics; an
   English voice mangles Tamil entirely.
2. **Naive switching.** Splitting on script runs mid-phrase produces audible seams, wrong
   prosody, and clipped consonants.
3. **Tanglish is invisible.** `vanakkam machan, epdi irukka?` is Latin script but Tamil
   speech. A script-only split sends it to the English voice.

Our design (full spec: [docs/05-tts-tamil-mixed.md](./docs/05-tts-tamil-mixed.md)):

- **Language-aware segmentation** — already built and tested in `packages/core/src/segmenter.ts`
  (196 lines of tests, 0 external deps). Tamil script detection + a curated Tanglish lexicon.
- **Transliteration** for Tanglish runs → Tamil script before Tamil synthesis, so the Tamil
  voice receives Tamil orthography.
- **Per-run voice routing** + **stitched timeline** with calibrated gaps and
  loudness matching, so voice changes are inaudible at phrase boundaries.
- **Golden-audio regression tests**: fixed inputs, duration/energy/word-count invariants, and
  a human-checked listening set.

This is Phase 1 and ships before anything visual.

---

## 4. Engineering discipline: code → test → next

Hard rule for every task in this repo:

```
            ┌───────────────────────────────────────────────┐
            │  1. write/adjust the contract (types/tests)   │
            │  2. write the smallest real implementation    │
            │  3. run the gate: typecheck + unit + e2e      │
            │  4. only then start the next task             │
            └───────────────────────────────────────────────┘
```

- A phase does not close while its gate is red.
- No "TODO: test later". If it cannot be tested yet, it is not in this phase.
- Every external engine has a **fake** behind the same port, so tests never hit the network
  by default; live tests are opt-in (`LIVE=1`) and separate.
- Every pipeline step writes an artifact + a row; therefore every step is independently
  testable and resumable.
- Details and the test matrix: [docs/08-testing.md](./docs/08-testing.md).

---

## 5. Stack

Chosen to reuse what already exists in the repo, and to keep every paid dependency optional.

| Layer | Choice | Why |
|---|---|---|
| Monorepo | npm workspaces + TypeScript strict | already in repo |
| API | Hono on Node 22 | already in repo, tiny, portable |
| Queue | **pg-boss** (Postgres-backed) | no Redis to run; transactional with the ledger |
| DB | Postgres 16 (Docker) + Drizzle ORM | already in compose file |
| Media service | Python 3.12 + FastAPI | already in repo, best TTS/ASR/ffmpeg ecosystem |
| Web | Next.js 15 App Router + Tailwind | editor + marketing in one app |
| Render | ffmpeg (filter graph + ASS subtitles) | deterministic, 4K capable, no GPU needed |
| Storage | local disk (dev) / S3-compatible or R2 (prod) | swappable `Storage` port |
| MCP | `@modelcontextprotocol/sdk`, Streamable HTTP | matches observed transport |

**Engines (all free; see [docs/06-free-sources.md](./docs/06-free-sources.md)):**

| Stage | Default | Fallback |
|---|---|---|
| Script → scenes | Cloudflare Workers AI (Llama 3.3 70B) | Groq → Ollama → deterministic splitter |
| Art-style profile | ffmpeg scene sampling + Cloudflare VLM | heuristic palette/shape analysis |
| Images | Cloudflare Workers AI `flux-1-schnell` | Pollinations → local ComfyUI/SDXL |
| TTS | edge-tts neural voices | AI4Bharat IndicF5 (Tamil) → Piper (offline) |
| ASR | faster-whisper (local) | Cloudflare Whisper large-v3-turbo |
| Captions | TTS word boundaries (exact, free) | Whisper word timestamps |

---

## 6. Phases and gates

Detailed task breakdown: [docs/09-roadmap.md](./docs/09-roadmap.md).
Live checklist: [docs/PROGRESS.md](./docs/PROGRESS.md).

| Phase | Outcome | Gate (all must pass) |
|---|---|---|
| **P0** Foundation | rename scope, contracts package, DB schema, queue, config, CI script | `npm run gate` green on empty schema; docker-compose up; health endpoints |
| **P1** Tamil/English TTS | mixed-language narration service, transliteration, stitched timeline | unit + golden-audio + live smoke; a real 60s Tanglish clip produced |
| **P2** Scene planner | script → scenes/beats with timings and image prompts | property tests, fallback determinism, ≤N chars per scene |
| **P3** Art style + images | reference video → style profile → per-scene stills | style profile schema tests; N images generated and visually inspected |
| **P4** Captions + render | word-level ASS + ffmpeg compose at 1080p/2K/4K | render golden test: exact duration/fps/resolution; Tamil glyph shaping verified |
| **P5** V3 pipeline | end-to-end `create-video` job, resumable, retry-safe | one 3-minute video end to end; kill-and-resume test; no duplicate charges |
| **P6** API v1 | `/v1/*` compatible surface, keys, credits, webhooks | contract tests against `docs/01-product-spec.md`; webhook retry simulation |
| **P7** MCP | `/mcp` with OAuth 2.1 + tools | MCP inspector run; a client creates a video via tool call |
| **P8** Web app | landing, studio, editor, gallery | Playwright happy path: script → video → download |
| **P9** Other templates | V2, Quiz, Fake Text, Roblox, Caption video | one e2e per template |
| **P10** Premium extras | animation, avatar/lip-sync, 2K/4K unlock, team seats | per-feature e2e + quality check |
| **P11** Launch | Docker, docs site, limits, monitoring, SEO | fresh-machine deploy in < 15 min |

---

## 7. Definition of done (the whole project)

- [ ] I can paste a 5-minute Tanglish script and get a finished 1080p video whose narration
      sounds Tamil where it should and English where it should, with correct word-level captions.
- [ ] I can upload a 2-minute reference video and get a reusable art style; new scenes look
      like that channel.
- [ ] I can kill the worker mid-render, restart, and the job resumes without re-paying for
      completed steps.
- [ ] A third-party client can create a video through `POST /v1/ai-videos-v3` **and** through
      the MCP tool `create_ai_video_v3`, with identical validation and cost.
- [ ] `npm run gate` and `pytest` are green on a clean clone.
- [ ] Everything runs with zero paid keys. Paid keys only *upgrade* quality/speed.
- [ ] Licence audit passes: fonts, models, voices, music, sample assets.

---

## 8. Open decisions (defaults chosen, revisit later)

| Question | Default now | Revisit at |
|---|---|---|
| Rename `@stickman/*` → `@facelesspro/*` | yes, P0 | — |
| Postgres vs SQLite for local dev | Postgres via Docker (matches prod) | P5 if dev friction |
| Remotion vs raw ffmpeg for captions | raw ffmpeg + ASS first | P4 if animation needs exceed filters |
| Style cloning depth | structured prompt + palette/character lock; LoRA later | P3 after visual review |
| Public hosting target | Docker on a VPS; R2 for storage | P11 |
| Billing provider | none at first (self-host unlimited); Stripe at launch | P11 |
