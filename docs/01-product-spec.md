# 01 — Product spec

The behavioural contract we are building to. Split into **parity** (must match vsub.io's
observable behaviour) and **our additions** (things we do differently or better).

Legend: `[P]` parity · `[+]` our addition · `[~]` parity but different implementation.

---

## 1. Core object model

```
Workspace ─┬─ Member (role: owner|admin|editor|viewer)
           ├─ ApiKey (vp_…, hashed, workspace-scoped)
           ├─ CreditLedger  (delta, action, videoId, unitCost)
           ├─ BalanceLedger (top-ups, charges)
           ├─ ArtStyle      (cloned from a reference video, or published)
           ├─ Voice         (bundled | imported)
           ├─ Asset         (image/gif/video/audio in object storage)
           ├─ CaptionTemplate
           ├─ BackgroundVideo
           └─ Video ─┬─ Scene[]      (order, script text, image, motion)
                     ├─ Narration    (audio, word timings, voice plan)
                     ├─ CaptionTrack
                     └─ Render[]     (mp4 variants: 1080p/2K/4K, 30/60fps, std/greenscreen)
```

A **Video** is a project. `status` describes generation; a render is a separate artifact.
This is why vsub can say *"the video stays an editable project you can render later"* and why
re-rendering at 60fps or green-screen is allowed on an already-completed video.

---

## 2. Video pipeline semantics `[P]`

```
POST create → status=processing, step=create-scenes
   ↓                       step=create-vocal
   ↓                       step=create-images
   ↓                       step=create-captions
   ↓                  status=rendering, step=render      (only if render requested)
   ↓
status=completed, videoUrl   |   status=failed, error, step
```

Rules:

1. Creation returns **immediately**; the caller polls or waits for a webhook.
2. `failed` is terminal for that attempt but **retry resumes at `step`**; completed steps keep
   their artifacts and are **not charged twice**.
3. `render` is optional at create time. Omitted → editable project.
4. Rendering is only allowed from a terminal-generation state (`processing`/`rendering` → 400).
5. Re-rendering replaces the mp4 (that is how you switch fps/format).
6. `videoUrl` is public, unauthenticated, and stable once completed.
7. Every state transition and credit movement is recorded, so the ledger can always explain
   a balance.

Credits are charged **per unit at the step that consumes it**, written to the ledger in the
same transaction as the step completing. That single rule is what makes resumability safe.

---

## 3. Templates

### 3.1 AI Video V3 `[P]` `[~]`

Script (or voiceover) → scenes → narration → images drawn in a **cloned art style**.

| Field | Type | Default | Notes |
|---|---|---|---|
| `artStyleId` | string | **required** | from `GET /v1/art-styles`; must support `size` |
| `script` | string | — | ≤30,000 landscape / ≤4,000 portrait; required unless `voiceoverUrl` |
| `voiceoverUrl` | https url | — | mp3/m4a/wav/ogg/aac/flac, ≤200 MB; script comes from ASR |
| `size` | `landscape`\|`portrait` | `landscape` | |
| `speed` | `slow`\|`standard` | `standard` | `slow` = 10% cheaper, longer deadline |
| `voiceId` | string | workspace default | ignored when `voiceoverUrl` |
| `voiceStyle` | object | see below | stability/similarityBoost/style/speed, each 0–100; speed is a percentage of normal rate, 50–200 |
| `captions` | boolean | `false` | V3 is artwork-first, captions off by default |
| `captionTemplateId` | number | last used | negative = built-in |
| `render` | object | omitted | `{}` accepts defaults |
| `webhookUrl` | https url | — | terminal-status callback |

`voiceStyle` defaults for V3: `{stability: 50, similarityBoost: 75, style: 0, speed: 100}`.

`script` and `voiceoverUrl` are **mutually exclusive**: exactly one is required. `render` accepts
`{}` and fills `{resolution: 1080, frameRate: 30, format: standard}`. These rules live in
`packages/contracts/src/requests.ts`, so the REST API, MCP and the editor cannot disagree.

**Our implementation `[~]`:** `artStyleId` maps to a **StyleProfile** document
(palette, line, composition, character bible, typography, negative prompt). See
[docs/04-pipeline.md](./docs/04-pipeline.md#4-art-style-cloning).

**Our addition `[+]`:** `script` accepts Tamil, English and Tanglish in the same string, and
`voicePlan` is derived automatically (see [docs/05](./05-tts-tamil-mixed.md)).

### 3.2 AI Video V2 `[P]`

Same shape, but `imageStyle` is one of 16 fixed presets and `transition` is
`smooth | strong-swipe`. Script ≤10,000 chars. Default `size=portrait`.
No `artStyleId`, no `voiceoverUrl`.

### 3.3 Quiz video `[P]`

`items[]` = `{type: question|comment, text ≤400, answers[], correctIndex, imagePrompt?}`.
`template` = `standard` (all answers, reveal correct) | `multi-levels` (one answer, ladder).
`answerTemplate` uses `{{answer}}` and only affects narration, not on-screen text.
`generateBackgroundImage` + `backgroundImagePrompt` + `generateQuestionImage` + `imageStyle`.
≤100 items.

### 3.4 Fake Text video `[P]`

`conversations[]` = `{template, language, characters[], messages[], autoSplit, groupName,
groupPhoto, tinderMatch, useVoiceV2}`. `characters[]` = `{name, id, side: left|right, voiceId}`.
≤1,000 messages total. Nine chat skins. Because messages are short and alternating, this is the
template that most needs a **low-latency** TTS path and per-character voice consistency.

### 3.5 Roblox Rant `[P]`

`script` ≤5,000 (split per sentence), `voicePitch` 50–180 (default 140), `captionWordLimit`
1–10 (default 6), `autoAddEmoji` (default true), `backgroundVideoId`,
`backgroundVideoStartFrom`.

### 3.6 Caption Video `[P]`

Upload (multipart `file`, ≤500 MB, ≤2 h) or `url`. ASR → word timings → burn captions.
`templateId`, `render`.

### 3.7 Comment / commentary video

Present in nav on the site; no public API page was found. `[+]` We implement it as a thin
preset over V3 (background + comment text + voice), and mark it **not parity-critical**.

---

## 4. Art styles `[P]` `[~]`

`GET /v1/art-styles` →

```jsonc
{ "styles": [{
    "id": "uuid", "name": "Whiteboard explainer", "published": true,
    "formats": ["landscape","portrait"],
    "previewUrl": "...png", "portraitPreviewUrl": "...png",
    "sampleVideoUrls": ["...mp4"],
    "status": "ready",
    "createdAt": "2026-07-19T11:04:52.000Z"
}]}
```

Rules `[P]`: styles still building are omitted; `published` distinguishes global vs
workspace-private; passing a `size` the style cannot draw is **rejected**.

Additive `[+]`: `status` is echoed on each entry. Because non-ready rows are omitted it is
always `ready` today, and it stays so that a later "show my building styles" filter is a
query change, not a breaking response change. All three URL fields (`previewUrl`,
`portraitPreviewUrl`, `sampleVideoUrls[]`) accept either an absolute URL or a `/files/...`
path, so a locally built style lists without requiring `PUBLIC_BASE_URL`.

Our builder `[~]`: reference video ≥30 s (≈3 min ideal), must contain narration. Steps:
probe → scene-detect frames → palette/stroke/composition analysis → character bible →
style prompt synthesis → preview grid + preview clip. See pipeline doc §4.

`GET /v1/art-styles/:id/export` `[+]` →

```jsonc
{ "version": 1, "name": "Whiteboard explainer", "formats": ["landscape"],
  "profile": { /* the exact StyleProfile from docs/04 §4 */ } }
```

The document is portable: no row id, storage keys, preview URLs or timestamps. `profile`
is re-validated as `styleProfileSchema` on the way out (a corrupt stored profile is
`500 internal`, never a half-export) and again on import. Non-ready styles answer
`409 conflict`; an unknown id `404 not_found`; a malformed id `400 invalid_request`
with `field: "id"`.

---

## 5. Voices `[P]` `[~]`

`GET /v1/voices` → `{id, name, description?, gender?, accent?, age?, useCase?, previewUrl?}`.
Filtered metadata is acceptable (fields omitted when unknown).

`[~]` Our voice catalogue is **capability-tagged**, which vsub does not expose:

```jsonc
{
  "id": "edge:ta-IN-PallaviNeural",
  "name": "Pallavi (Tamil)",
  "languages": ["ta"],
  "mixesEnglish": true,        // handles English loanwords natively
  "engine": "edge",
  "sampleRate": 24000,
  "wordTimings": true,          // can emit WordBoundary
  "previewUrl": "/audio/voices/..."
}
```

`[+]` Explicit Tamil voices: `ta-IN-PallaviNeural`, `ta-IN-ValluvarNeural`, plus IndicF5
Tamil and Piper offline voices. `[+]` Voice **import** (bring your own reference clip) is
planned with a consent gate (see legal doc).

---

## 6. Captions `[P]` `[+]`

`[P]` caption templates with negative ids for built-ins, per-word display limit, animated
emoji sprinkling, burn-in on render.

`[+]` A template's `spec` is ours (`CaptionSpec` in `packages/contracts/src/responses.ts`):
`fontFamily`, `fontSize`, `wordLimit`, `maxLines`, `uppercase`, `emoji`, `position`,
`highlightColor`, `outlineColor`, `outlineWidth`. All optional, because a template that omits a
field inherits the renderer default.

`[+]` Two caption sources, in priority order:

1. **TTS word boundaries** — exact, free, already aligned to the audio we generated.
2. ASR word timestamps (faster-whisper) when the narration came from an upload.

`[+]` Tamil rendering correctness is a hard requirement: Noto Sans Tamil is bundled, and
shaping is verified with a render test, because Tamil combining marks break in naive
drawtext pipelines (see roadmap P4).

---

## 7. Export `[P]` `[+]`

| | vsub Premium+ | ours |
|---|---|---|
| 1080p | ✅ | ✅ default |
| 2K | ✅ | ✅ `[P]` |
| 4K | ✅ (Max listed) | ✅ `[P]` |
| 30 / 60 fps | ✅ | ✅ |
| green screen variant | ✅ | ✅ |
| aspect | 16:9, 9:16 | 16:9, 9:16 `[P]`; 1:1 `[+]` |
| background music / ducking | implied | `[+]` planned P10 |

---

## 8. Credits & plans `[P]`

Keep the **shape**, not the prices:

```ts
type Plan = { id: 'free'|'pro'|'premium'|'premium_plus'|'max'|'selfhost',
              // null = unlimited, because JSON has no Infinity
              minutesPerMonth: number | null, creditsPerMonth: number | null,
              maxVideoMinutes: number, maxResolution: 1080|1440|2160,
              seats: number }
```

`maxResolution` is the vertical pixel count of the export ladder in §7 (1080p / 2K / 4K). The
earlier `4320` value described an 8K tier that no endpoint offers, so it was removed rather than
left as a plan ceiling nothing can reach.

Dev/self-host default: a `selfhost` plan with `Infinity` credits and a ledger that still
records unit costs, so cost-per-video remains measurable.

---

## 9. Webhooks `[P]`

- `webhookUrl` per creation and/or per render call; stored and reused on later renders.
- HTTPS only (reject `http://`), localhost rejected.
- `POST` JSON `{event, video}` where `event` is `completed` or `failed` and `video` is identical
  to `GET /v1/videos/:id`. Non-terminal transitions are not notified; a render finishing fires
  `completed` a second time.
- At-least-once; 10 attempts at 30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 8 h, 8 h.
- Non-2xx / timeout / DNS / TLS = failure. Body ignored.
- Dedupe via an id header.
- `[+]` We **will** sign bodies (HMAC-SHA256 + timestamp) *and* keep the id header, because
  unsigned webhooks are a real security weakness at scale. Unsigned mode stays available for
  parity.

---

## 10. MCP `[P]`

Endpoint `/mcp` over Streamable HTTP. Two onboarding modes:

1. **OAuth 2.1 + PKCE (S256)**, dynamic client registration (RFC 7591), protected-resource
   metadata (RFC 9728) + authorization-server metadata (RFC 8414), access 12 h / refresh 90 d
   with rotation, revoke endpoint. "Paste the URL, approve a workspace" — no token.
2. **Static bearer API token** for clients that cannot do OAuth.

Tools = endpoints, one-to-one, same validation and same cost:

```
create_caption_video      create_ai_video_v3     create_ai_video
create_quiz_video         create_roblox_video    create_fake_text_video
read (status)             render_video           upload_file
list_voices               list_sound_effects     list_background_videos
text_to_speech            create_fake_text_screenshot
list_caption_templates    list_art_styles        get_workspace
list_credit_logs          list_balance_logs
```

A failing tool returns error **text**, not a protocol error, so the assistant can correct its
arguments and retry. `[P]`

`[+]` Our MCP adds `plan_video` (dry-run: cost + scene count + estimated duration, no charge)
and `set_narration_language` (enables `auto` mixed-mode for Tamil+English).

---

## 11. Editor (`[P]`, own design)

Required affordances:
- scene list with generated image, script text, duration;
- redraw one scene (with prompt nudge), regenerate all;
- edit script → re-narrate only the changed scenes;
- caption style + word-limit + emoji toggle with live preview;
- timeline scrub with audio waveform;
- render panel (resolution, fps, format) with cost preview;
- download + share link.

`[+]` Per-scene **voice plan inspector**: shows which runs were routed to Tamil vs English and
lets me override a single run. This is the debugging surface for our differentiator.

---

## 12. Out of scope (for now)

- Mobile apps.
- Real-time collaborative editing (team *seats* yes, live co-editing no).
- Marketplace of paid community templates.
- Voice cloning of third-party speakers (consent-gated import only).
