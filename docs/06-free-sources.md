# 06 — Free sources, and how to swap them

Principle: **the project must run with zero paid keys.** Paid engines are quality upgrades
behind the same port, never a requirement.

Every entry below is a *default choice*, not a commitment. If a free tier changes, we edit one
adapter and one env var.

---

## 1. Engine matrix

### 1.1 Script → scenes (planner)

| Rank | Source | Free allowance (verify before relying) | Quality | Notes |
|---|---|---|---|---|
| 1 | **Cloudflare Workers AI** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | free daily neurons (~10k/day) | good JSON obedience | same account as images |
| 2 | **Groq** `llama-3.3-70b-versatile` | generous free tier, very fast | good | key: `GROQ_API_KEY` |
| 3 | **Gemini** `2.0-flash` | free tier per project | very good long-context | also used for style VLM |
| 4 | **Ollama** `qwen2.5:7b-instruct` / `llama3.1:8b` | unlimited, local | fine | zero network, needs ~6 GB RAM |
| 5 | **Heuristic splitter** | n/a | crude but deterministic | always available, no model |

Planner fallback ladder is `cloudflare → groq → ollama → heuristic`. The heuristic is not a
toy: it packs sentences to a target duration and builds image prompts from noun phrases, so a
video still completes when every model is down.

### 1.2 Images

| Rank | Source | Access / allowance | Notes |
|---|---|---|---|
| 1 | **Cloudflare Workers AI** `@cf/black-forest-labs/flux-1-schnell` | free daily neurons | 4-ish steps, fast, 1024px class |
| 2 | **Pollinations.ai** | account key + Pollen balance | current `gen.pollinations.ai/image/{…}`; legacy keyless output is watermarked and rejected |
| 3 | **Hugging Face Inference** | small free quota | many SDXL/Flux endpoints |
| 4 | **Local ComfyUI** (SDXL / Flux-schnell GGUF) | unlimited | needs a GPU to be usable |
| 5 | **Procedural renderer** | unlimited | deterministic palette-only template PNG — plain but never fails |

The procedural renderer matters more than it looks: it makes the *pipeline* testable without
any model, and it guarantees the "video always completes" property. The implemented adapter is
1024×576 / 576×1024, seeded, uses only `StyleProfile.palette` colours, and encodes RGB8 PNG with
Node's built-in zlib; it needs no ffmpeg, native image dependency, network or GPU.

The implemented Cloudflare adapter calls the account-scoped Flux Schnell endpoint with the final
prompt, caller-owned seed and 1–8 steps. Cloudflare returns a base64 JPEG without an aspect input,
so the adapter bounds and validates the bytes, then uses ffmpeg to centre-crop them into exact
1024×576 / 576×1024 RGB24 PNGs. Model, steps and timeout are overridable with
`CLOUDFLARE_IMAGE_MODEL`, `CLOUDFLARE_IMAGE_STEPS` and `CLOUDFLARE_IMAGE_TIMEOUT_MS`.

The implemented Pollinations adapter calls the current authenticated image endpoint with canonical
`black-forest-labs/flux.1-schnell`, exact geometry and seed. It streams at most 25 MiB, checks MIME
against JPEG/PNG/WebP magic, and normalizes through the same RGB24 PNG boundary. A key is required
in practice (`POLLINATIONS_API_KEY`) even though one current agent guide still describes image GET
as keyless: a live request returned 401. The legacy keyless host did return an image, but visibly
watermarked it despite `nologo=true`, so FacelessPro refuses to use or strip that path. With no key,
the factory skips Pollinations and continues to ComfyUI/procedural.

The implemented ComfyUI adapter is fully local and model-agnostic: an API-format workflow supplies
the loader/sampler nodes, while five placeholders receive FacelessPro's prompt, negative prompt,
seed and exact dimensions. It submits through `/prompt`, polls `/history/{id}`, downloads the one
configured output through `/view`, bounds it to 25 MiB and applies the shared RGB24 PNG normalizer.
Use `fixtures/workflows/comfyui-sdxl-api.json` as a shape example after changing its checkpoint name,
or export a Flux/GGUF workflow with the same placeholders. No model or custom node is downloaded by
FacelessPro, and a server timeout does not invoke ComfyUI's global `/interrupt` route.

### 1.3 TTS

See [05](./05-tts-tamil-mixed.md#4-engines). Summary: `edge-tts` default (free, Tamil +
WordBoundary), IndicF5 for Tamil-first quality, Piper for fully offline. Licence caveat on
edge-tts is documented as a launch blocker.

### 1.4 ASR

| Rank | Source | Notes |
|---|---|---|
| 1 | **faster-whisper** `large-v3-turbo` (CTranslate2) | local, free, word timestamps, CPU-usable at `int8` |
| 2 | **Cloudflare** `@cf/openai/whisper-large-v3-turbo` | no local install |
| 3 | **whisper.cpp** | tiny footprint, offline |

Tamil support in Whisper large-v3 is decent, not perfect. For voiceover intake we only need
*word timings plus a faithful transcript*; the user can edit the transcript in the editor.

### 1.5 Vision (art-style extraction)

| Rank | Source | Notes |
|---|---|---|
| 1 | **Cloudflare VLM** (`@cf/llava-hf/llava-1.5-7b-hf` or current) | free-ish, adequate for medium/line/composition descriptions |
| 2 | **Gemini flash** vision | better descriptions, still free-tier |
| 3 | **Heuristic** (numeric profile only, no model) | zero cost, deterministic; `medium` is honestly `unknown` |

Configured as `STYLE=cloudflare,gemini,heuristic`; the first healthy adapter wins and the
answer records `degradedFrom`. The palette is **not** asked of a model at any rank — it is
measured by the numeric pass (docs/04 §4), so a VLM guess can never override a pixel.

### 1.6 Assembly & motion

| Need | Free tool |
|---|---|
| compose, trim, concat, mux | **ffmpeg** (system binary) |
| captions burn-in | ffmpeg `subtitles=` filter + ASS |
| Ken Burns / pan / zoom | ffmpeg `zoompan` |
| still → motion (V2/V3 parity) | local **Stable Video Diffusion** / **AnimateDiff** (GPU) — or skip |
| lip-sync (avatar parity) | local **Wav2Lip** / **MuseTalk** (GPU) — or skip |
| music + ducking | ffmpeg `sidechaincompress`, CC0 music |
| thumbnails | ffmpeg single-frame |

### 1.7 Infra

| Need | Free option |
|---|---|
| Postgres | Docker locally; Neon free tier |
| Object storage | local disk; Cloudflare R2 free tier; MinIO |
| Queue | pg-boss (in Postgres) |
| Hosting | any VPS; Fly.io/Render free-ish tiers |
| CDN | Cloudflare |
| Email (magic link) | Resend free tier / SMTP |

---

## 2. What the user has confirmed

**Cloudflare Workers AI** (free daily allowance) → primary for planner, images, and VLM.
Everything else falls back automatically, so a Cloudflare outage slows us down rather than
stopping us.

`.env`:

```env
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...        # Workers AI:Read
POLLINATIONS_API_KEY=...        # optional; current image endpoint requires it
PLANNER=cloudflare,groq,ollama,heuristic
IMAGE=cloudflare,pollinations,comfyui,procedural
STYLE=cloudflare,gemini,heuristic
```

---

## 3. How to make it "update-able for the future"

Four mechanisms, in increasing order of effort:

1. **Env-ordered adapter chains.** `PLANNER=a,b,c` — first healthy wins. Adding a provider is
   one file + one line of config. No pipeline changes, ever.
2. **Capability registry.** Each adapter declares what it can do:
   ```ts
   export const cloudflareImage: ImagePort = {
     name: 'cloudflare',
     capabilities: {
       maxSide: 2048,
       sizes: ['landscape', 'portrait'],
       style: 'profile',
       seed: true,
     },
     draw: async (request) => generateWithCloudflare(request),
   }
   ```
   The pipeline asks the registry, not the vendor. A new model with better capabilities is
   picked up automatically where it fits.
3. **Versioned data files, not code.** Tanglish lexicon, caption templates, image-style
   presets, pricing table, and prompt fragments live in `data/*.json` with a `version` field.
   Updating a prompt or adding slang is a data change I can make without touching TypeScript.
4. **Model pins in one manifest.** `data/engines.json` holds every model id + revision:
   ```jsonc
   { "image": { "cloudflare": { "model": "@cf/black-forest-labs/flux-1-schnell", "rev": 2 } } }
   ```
   Upgrading a model = editing this file + re-running the visual regression suite.

---

## 4. Free-tier reality check

| Concern | Reality | Mitigation |
|---|---|---|
| Free tiers change without notice | certain | adapter chains + heuristic fallbacks |
| Image generation is the bottleneck | yes, on free tiers | `speed=slow` batches, scene-level caching, procedural fallback |
| Rate limits during a 35-scene video | likely | concurrency caps per provider, backoff, resume from `create-images` |
| Cloudflare neuron budget | ~10k/day free is not 206k credits of images | local ComfyUI or a paid ~$5 top-up for volume; both optional |
| Model quality drift | models get deprecated | `engines.json` pins + regression samples |
| edge-tts endpoint changes | possible | it's behind `TTSPort`; IndicF5/Piper are drop-in replacements |

**Cost of a 5-minute video with all-free defaults: $0** — at the price of time (~3–10 min) and
daily quotas. That is the trade this project is built around.

---

## 5. Addendum: what we will *not* rely on

- No scraping of vsub.io at runtime. Their API is not our backend.
- No unofficial paid-service key sharing, no trial farming.
- No model that requires accepting a licence incompatible with publishing.
- No silent telemetry to third parties.
