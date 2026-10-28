# 04 — Generation pipeline

One video, end to end. Every step: **input → work → artifacts → ledger → next**.

---

## 0. Intake

```
POST /v1/ai-videos-v3
```

1. Auth: bearer `vp_…` → workspace.
2. Validate with `CreateAiVideoV3` zod schema (network-free, instant).
3. Resolve `artStyleId` → must exist, be `ready`, and support `size`.
4. Reject if `script` present **and** `voiceoverUrl` present (exactly one), or neither.
5. Reject if the script is likely to exceed the plan's max minutes
   (`estimateDuration()` in `packages/core`: ta 130 / en 150 / mixed 140 wpm, numbers expanded
   first; Tamil ≈ 130 wpm is the anchor).
6. Insert `video` row (`status=processing`, `step=create-scenes`, `request` normalised).
7. Enqueue `create-scenes`. Return `{id, status, render: bool, createdAt, editorUrl}` in < 100 ms.

Nothing expensive happens in the request.

---

## 1. `create-scenes`

**In:** script (or voiceover → ASR first, step 1b), style profile, size, target duration.
**Out:** `scene[]` with text, estimated duration, image prompt.

```
script ──► normalise ──► language plan ──► split into beats ──► scene objects
                             │
                             └─ per-run lang tags (ta | en | tanglish)
```

Sub-steps:

1. **Normalise** — unify curly quotes and apostrophes to ASCII, keep dashes (an em dash is
   prosody: the listening gate approved a clip that has one), collapse whitespace, drop
   zero-width spaces, keep emoji. Then split into sentences with an abbreviation-safe splitter
   (`packages/core/src/sentences.ts`): Tamil and Latin both end on `.`, `?`, `!`, plus `…` and
   the danda; `3.5`, `Rs.500`, `Dr.`, `p.m.`, `A. R.` and `திரு.` stay inside their sentence;
   a blank line is a boundary; an ellipsis ends a sentence only before a new one; a period
   inside `[[…]]` never splits; a Tamil quotative stays with the quote it closes
   (`"நான் வருகிறேன்?" என்று கேட்டார்.` is one sentence). Sentences are slices of the
   input, so `concat(scene.text) === normalizeScript(script)` is an invariant, not a hope.
2. **Language plan** — run `segmentText()` from `packages/core`; annotate each sentence with
   its dominant script and a per-run plan. Cheap, deterministic, no model.
3. **Duration estimate** — `estimateDuration()` from `packages/core` turns text into seconds at
   ta 130 / en 150 / mixed 140 wpm plus one 300 ms sentence gap, expanding numbers first so
   `₹1,20,000` is priced as the four words the engine speaks. This is the number the request
   path uses to reject an over-long script (before any audio exists) and the number scene
   packing targets. Calibrated against the shipped sample sets: Tamil −1.5% mean / 6.2% MAE,
   mixed −0.5% / 8.6% MAE. Pure-English clips run faster than 150 wpm on the shipped voices
   (153–202 wpm, +20.5% mean error), so an English-only script is estimated ~15% long; the
   planner may pass per-pair `rates` once it knows the voice. Commas and clause pauses are
   deliberately not modelled, which is why a comma-dense 7 s clip can read −20%.
4. **Beat splitting** — LLM returns JSON only, and never timings:
   ```jsonc
   { "scenes": [
       { "text": "…", "imagePrompt": "…", "motion": "kenburns-in", "emphasis": ["word"] }
   ]}
   ```
   The stored shape is `scenePlanSchema` (`packages/contracts/src/planner.ts`) —
   `{ scenes: [{ text, imagePrompt, motion, emphasis, startMs, endMs }], adapter, degradedFrom,
   totalMs }` — where `motion` must be one of `SCENE_MOTIONS` (the presets the render service
   implements), a prompt is ≤1000 chars, and `startMs`/`endMs` come from `packages/core`, so a
   model cannot move a cut. `adapter` names who planned it and `degradedFrom` lists the adapters
   that failed first: a degraded video is explainable afterwards without reading logs.
   Constraints enforced *after* the model: scene count, 8–20 s per scene measured with
   `estimateDuration()` (characters are not the budget — Tamil and English do not have the same
   chars-per-second), no empty scenes, text concatenation must equal the original script
   (modulo whitespace).
5. **Repair loop** — if the model output violates constraints, re-ask once with the diff;
   then fall back to **`packScenes()`** from `packages/core`: a dynamic programme over sentences
   that keeps every scene inside 8–20 s (splitting an over-long sentence at word boundaries,
   with no pause at the cut), caps the plan at 120 scenes by merging the cheapest adjacent pair,
   and makes the scene spans add up to the narration estimate. Never fail the video here.
   This fallback is a real adapter, not a special case: `planner/heuristic.ts` implements
   `PlannerPort`, so `PLANNER=cloudflare,groq,heuristic` ends in it and a test can use it as the
   offline fake. Its image prompts are a templated description of the scene's own words —
   literal, literal-minded, and honest about it: without a model it cannot say *what the picture
   is*, only what is being said, so an LLM image adapter is what makes prompts good.
6. **Image prompts** — one per scene, style-injected:
   `"{style.promptPrefix}, {scene description}, {style.paletteClause}, {style.lineClause},
     no text, no watermark, {style.negative}"`. The heuristic adapter bounds the description to
   18 whole words / 220 characters (never splitting a Tamil cluster) and keeps the style clauses,
   because the style carries the look of the whole video.

**Artifacts:** `plan.json`. **Ledger:** planner tokens are not billed to the user in self-host
mode; recorded as `action=plan` with `units=0` for observability.

**Test hooks:** golden script → snapshot of scene count and scene durations; property test
"concat(scenes.text) preserves script"; fallback determinism test.

### 1b. `create-scenes` with a voiceover

If `voiceoverUrl` is present:

1. Download (cap 200 MB, allow-list of extensions, HTTPS only).
2. ASR with word timestamps (faster-whisper) → transcript + timings + detected language.
3. Transcript **is** the script; scenes are split on the ASR sentence boundaries so the
   picture cuts land where the speaker breathes.
4. **No TTS is run.** `voiceId`/`voiceStyle` are ignored (parity).
5. Narration asset = the uploaded audio, normalised (loudness + true peak) and re-encoded to
   AAC 48 kHz.

---

## 2. `create-vocal`

**In:** scene text + voice plan + `voiceStyle`.
**Out:** one audio track + word timings + per-scene audio offsets.

```
voicePlan ──► [run: ta]  ──► TTS(ta voice)  ──┐
          ──► [run: en]  ──► TTS(en voice)  ──┼──► stitch ──► loudness ──► mp3/aac
          ──► [run: tanglish] ──► transliterate ──► TTS(ta voice)
```

1. Build the **voice plan** (see [05](./05-tts-tamil-mixed.md)) — runs, not sentences, so
   mid-sentence switching is allowed.
2. Synthesise each run. Concurrency 4–8. Each run is cached by `hash(engine, voice, text)` — the
   text *after* transliteration and number expansion — so a retry, or an unchanged scene in a new
   video, costs ffmpeg time instead of a network call. Implemented in
   `services/media/app/cache.py`; see [05 §3.7](./05-tts-tamil-mixed.md).
3. Trim silence, compress the provider's *internal* word pauses (60–250 ms → 50 ms), insert a
   calibrated gap (`120–200 ms`, proportional to punctuation), match loudness run-to-run
   (`loudnorm` two-pass), then concatenate. The internal-pause step is what stops edge-tts's
   Tamil voice from sounding word-by-word; [05 §3.4](./05-tts-tamil-mixed.md) has the numbers.
4. Word timings: engine-provided (`WordBoundary`) with a global offset per run; if missing,
   forced-align with ASR. Store `start_ms`/`end_ms` per word, plus per-scene ranges.
5. Probed duration corrects the planner's estimate → scene durations are **re-derived** from
   real audio, so images and captions always match the voice.

**Artifacts:** `audio/narration.m4a`, `audio/scene-NNN.m4a`, `timeline.audio.json`.
**Ledger:** `action=tts`, `units=characters`, per engine.

---

## 3. `create-images`

**In:** scene image prompts + style profile + size.
**Out:** one still per scene (+ optional motion file).

1. Compose the final prompt from style profile + scene prompt + deterministic seed
   (`hash(videoId, sceneIdx)`) so a redraw is reproducible.
2. Negative prompt from the style profile, always including `text, watermark, logo, signature`.
3. Generate at the target aspect. Batch by provider limits.
4. Post-process: upscale to render size, colour-correct toward the style palette (LAB shift,
   ≤6 ΔE), consistency check (histogram distance vs. existing scenes), then store.
5. Optional `motion`: `kenburns-in|out|pan-l|pan-r|none`. P10 adds real image-to-video.

**Artifacts:** `frames/0001.png …`, `frames/manifest.json` (prompt, seed, provider, recycle).
**Ledger:** `action=image`, `units=ceil(scenes/20)`, plus animation seconds if enabled.

**Quality guard:** if histogram distance for a scene is an outlier, regenerate once with
`+ same character, same palette as previous scene` appended.

---

## 4. Art-style cloning (the "template" step)

Runs once when a style is created, not per video.

```
reference.mp4
   │ ffprobe: duration, fps, resolution, audio
   │ reject if < 30s, no audio, or > 10 min
   ▼
frame sampling (scene-change detection, 8–24 frames, plus 3 evenly spaced)
   ▼
┌──────────────────────────────┐
│ vision pass (VLM)            │  palette, medium, line weight, shading,
│                              │  background treatment, composition,
│                              │  typography presence, recurring characters
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ numeric pass (no model)      │  k-means palette (hex + %), stroke density,
│                              │  edge energy, saturation/contrast stats,
│                              │  aspect + safe-area behaviour
└──────────────┬───────────────┘
               ▼
StyleProfile (jsonb) ──► preview grid + 6 s preview clip ──► status=ready
```

`StyleProfile` (our schema, stored in `art_style.profile`):

```jsonc
{
  "version": 1,
  "medium": "flat vector cartoon",
  "promptPrefix": "flat 2d cartoon illustration, thick black outlines",
  "palette": { "hex": ["#1b2a41", "#f2c14e", "#e4572e"], "weights": [0.5,0.3,0.2] },
  "line": { "weight": "thick", "color": "#141414", "texture": "clean" },
  "shading": "cel",
  "background": "simple gradient, low detail",
  "composition": "centered subject, eye-level, medium shot",
  "characters": [{ "id": "hero", "description": "young man, red hoodie, short black hair" }],
  "typography": { "present": true, "style": "bold sans, white with black outline" },
  "negative": "photo, 3d render, text, watermark, extra fingers",
  "seedBase": 1337
}
```

**Honest limitation:** this is *style locking by description + palette + character bible*, not
a trained model. It will look consistent and on-brand, but it will not reproduce a specific
artist's linework pixel-for-pixel. LoRA/finetune per style is the upgrade path (P10), and it
needs GPU time — a paid accelerator or a local GPU, never a hard dependency.

**Rejection rules (parity):** < 30 s, silent video, unreadable file → 400 with a clear message
telling the user what to upload instead.

---

## 5. `create-captions`

**In:** narration word timings, caption template, `captions` flag, word limit, emoji setting.
**Out:** `captions.ass` (+ `captions.json`).

1. Group words into cues by template rules: max chars/line, max lines, max words, punctuation
   priority, never break a Tamil grapheme cluster.
2. Karaoke styling: per-word highlight spans (`\k`) so the current word pops.
3. Emoji sprinkling: only on emphasis words, only from an allow-list, ≤1 per 2 cues (opt-in).
4. Render `ASS` with the **bundled** fonts (`NotoSansTamil-Regular/Bold`), explicit
   `ScaledBorderAndShadow`, and a fallback chain, so Tamil shaping is correct.
5. `--copyts`/timing accounted for the audio's actual start.

**Ledger:** `action=subtitles`, `units=1` per video (20 credits parity).

---

## 6. `render`

**In:** timeline (scenes + audio + captions) + `{resolution, fps, format}`.
**Out:** mp4 (+ optional green-screen mp4) + thumbnail + srt/vtt sidecars.

```
ffmpeg -f concat scene clips
  scene clip = still (or motion) ── zoompan/scale ── trim to scene duration
  + audio: narration (already stitched)
  + subtitles: burn ASS
  + optional music with ducking (sidechaincompress)
  → libx264 -preset medium -crf 18 (1080p) / 16 (2K/4K)
  → +faststart, yuv420p, AAC 192k
```

Determinism rules: fixed fps and `-r`, `-vsync cfr`, no timestamps in output, seeded zoompan.
That makes the render snapshot-testable (duration/fps/resolution/digest of first N frames).

Variants by `format`:
- `standard` → normal composition.
- `greenscreen` → background replaced with `#00FF00`, captions/overlays retained.

**Ledger:** `action=render`, `units=minutes`, 10 cr/min @30fps, 20 @60fps.

---

## 7. Idempotency & resume, concretely

```ts
// apps/worker/src/steps/create-images.ts (shape)
const result = await withStep(deps, videoId, 'create-images', async (ctx) => {
  const missing = await missingScenes(ctx.db, videoId);      // reads, outside the tx
  if (missing.length === 0) return { reused: true };         // nothing done, nothing charged
  const results = await imagePort.drawAll(missing);          // network, never inside a tx
  await ctx.transaction(async (tx) => {
    for (const r of results) insertSceneImage(tx.db, r);     // artifacts
    await tx.charge({ action: 'image', units: 2, unitCost: 1.5 }); // money
    await tx.advance();                                      // cursor + next job
  });
});
```

`withStep` (`packages/queue/src/step.ts`) resolves with one outcome:

| Outcome | Meaning |
|---|---|
| `committed` | the body opened exactly one commit and it landed |
| `reused` | the body reported the work already exists; cursor advances, nothing charged |
| `stale` | `video.step` has already moved past this job — drop it |
| `locked` | another attempt holds a live `job_lock` — drop it (`retryAfterMs` says when it expires) |
| `superseded` | this attempt lost the lock race; it rolled back and must not touch anything |
| `failed` | a permanent failure was recorded on the video |
| `missing` | the video was deleted while the job was queued — drop it |

Rules the helper enforces, so a step cannot forget them:

- **One commit.** `charge()` and `enqueue()` exist only on the commit handle; an artifact write
  without a cursor update, or a ledger row outside the state change, is not expressible.
- **The lock is a fence, not a mutex.** A live lock is respected; an expired one is taken over
  with `attempt + 1`. The commit re-checks that the lock still carries *our* attempt, so a worker
  descheduled past the TTL can only roll back. `attempt` fences one lock's lifetime and resets
  when the lock is released — it is not a retry counter.
- **Failures release the lock.** A permanent failure records `status=failed`, `error` and keeps
  the step as the resume point; a retryable one rethrows to pg-boss untouched. Either way the
  next attempt can claim immediately instead of waiting out the TTL.

Because a step commits once, **a crash redoes that step**: artifacts, ledger and the next job
are rolled back together, so there is no partial scene list to skip and no charge to double.
Artifacts from *earlier* steps survive, which is what makes "retry after `failed`" cheap.

- Re-render → new `render` row, same timeline, only render units charged.
- Retry after `failed` → `step` names the resume point.

---

## 8. Timing budget (5-minute Tamil video, self-host, free engines)

| Step | Warm | Cold | Notes |
|---|---|---|---|
| create-scenes | 2–6 s | 2–6 s | one LLM call + repair |
| create-vocal | 45–90 s | 3–6 min | ~40 runs, edge-tts is network-bound; IndicF5 slower |
| create-images | 60–150 s | 2–5 min | ~35 scenes; free image tiers are the bottleneck |
| create-captions | < 1 s | < 1 s | pure TS + one ASS write |
| render 1080p | 30–60 s | 1–3 min | CPU; 4K is 3–4× |
| **total** | **~3 min** | **~10 min** | comfortably under the "3 hours" parity ceiling |

---

## 9. Observability

Every step emits a structured event:

```jsonc
{ "videoId":"…", "step":"create-images", "attempt":1, "adapter":"cloudflare",
  "items":35, "ok":34, "failed":1, "ms":84210, "bytes":18340233,
  "costUnits":2, "degradedFrom":"cloudflare" }
```

Stored in `job_event` (append-only). The editor's "why did this fail" panel and the ops doc
both read from it.
