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

| Rank | Source | Free allowance | Notes |
|---|---|---|---|
| 1 | **Cloudflare Workers AI** `@cf/black-forest-labs/flux-1-schnell` | free daily neurons | 4-ish steps, fast, 1024px class |
| 2 | **Pollinations.ai** | free, no key, rate-limited | `https://image.pollinations.ai/prompt/{…}?width=&height=&seed=&nologo=true` |
| 3 | **Hugging Face Inference** | small free quota | many SDXL/Flux endpoints |
| 4 | **Local ComfyUI** (SDXL / Flux-schnell GGUF) | unlimited | needs a GPU to be usable |
| 5 | **Procedural renderer** | unlimited | deterministic vector/template art — ugly but never fails |

The procedural renderer matters more than it looks: it makes the *pipeline* testable without
any model, and it guarantees the "video always completes" property.

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
| 1 | **Cloudflare VLM** (`@cf/llava-hf/llava-1.5-7b-hf` or current) | free-ish, adequate for medium/palette descriptions |
| 2 | **Gemini flash** vision | better descriptions |
| 3 | **Heuristic** (k-means palette + edge/stroke stats, no model) | zero cost, surprisingly usable for palette/contrast; weak on "medium" |

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
PLANNER=cloudflare,groq,ollama,heuristic
IMAGE=cloudflare,pollinations,comfyui
STYLE=vlm,heuristic
```

---

## 3. How to make it "update-able for the future"

Four mechanisms, in increasing order of effort:

1. **Env-ordered adapter chains.** `PLANNER=a,b,c` — first healthy wins. Adding a provider is
   one file + one line of config. No pipeline changes, ever.
2. **Capability registry.** Each adapter declares what it can do:
   ```ts
   export const cloudflareImage: ImageAdapter = {
     id: 'cloudflare',
     capabilities: { maxSide: 2048, aspect: ['16:9','9:16','1:1'], styles: 'prompt', seed: true },
     health: async () => boolean,
     draw: async (req) => Image,
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
