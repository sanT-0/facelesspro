# 02 — How vsub.io was analysed (REA notes)

This document separates three things on purpose:

- **Observed** — read from bytes or from public documentation. Citable.
- **Inferred** — a reasonable conclusion from observations, but not proven.
- **Unknown** — not established, and not needed for our design.

Everything below was gathered with **REA** (Reverse Engineering Assistant) plus public
documentation. No authentication was bypassed, no private API was called, no code was copied.

---

## 1. Target routing

vsub.io is a **live SaaS web application**, not a shipped desktop artifact. So the applicable
REA routes were:

| Route | Used | Why |
|---|---|---|
| `analyze_javascript_application` | ✅ | The Next.js client bundles are shipped bytes; they reveal endpoints, tool names, storage hosts, feature flags. |
| Browser / network capture (`capture_browser_scenario`, `inspect_web_network_capture`) | ⬜ not needed yet | Would only add value for authenticated editor flows. Revisit if we need exact request payloads for the editor. |
| `open_binary` / native analysis | ❌ n/a | No native binary involved. |

### Artifact identity

```
subject   : C:\Users\sanT\AppData\Local\Temp\opencode\vsub-js
format    : directory (mirror of https://vsub.io/_next/static/**)
sha256    : 0e4ec54679811370ca8a087558804fa8c47d378fe22a2da2da34f176c3384572
files     : 36 relevant, 34 parsed javascript, 0 parse failures
ast nodes : 354,669
evidence  : ev_925a537540e6119a2687f1a734622aca4813369e39d1d394b8cf72e57b13e9e1  (complete analysis)
            ev_2563f369b4bddb87737c7c50d40ca7aa171522bda91bdddc82fb08fb8ad11f0c  (summary view)
```

### Coverage and limitations (verbatim from REA, and they matter)

- Graph coverage is **partial**: one chunk (`b056a15eec95302c.js`) exceeded the 1 GiB worker
  heap; 11 inline scripts in `index.html` were not analysed. Endpoint findings from those are
  absent — absence of evidence, not evidence of absence.
- JavaScript and HTML were parsed as **inert text**; no bundle was executed.
- Static endpoints and relationships do **not** prove runtime execution.
- Webpack/Rspack factories were recovered from AST literals; bootstrap code was not invoked.

**Consequence for us:** endpoint names below are *observed strings*, not verified live
behaviour. Where behaviour matters (validation, cost, status machine) we rely on vsub's own
public API documentation, which is an authoritative statement of intent.

---

## 2. What was observed

### 2.1 Hosts

| Host | Role (inferred from usage) |
|---|---|
| `api.vsub.io` | API + MCP endpoint (`/mcp`) |
| `storage.vsub.io` | object storage; `public-assets/client/...`, `r2-sample-videos/`, `vsub-sample-videos/` |
| `cf-content.vsub.io` | CDN for sample videos |
| `files.vsub.io` | generated artifact URLs (seen in API docs, e.g. `art-styles/...png`) |

### 2.2 Client-side API surface

Observed literal paths in the bundles:

```
/api/ai-videos-v3
/api/mcp
https://api.vsub.io
```

And the documented public API (see §3) is a superset. The client-side `/api/*` routes are the
Next.js same-origin proxies; the real surface is `https://api.vsub.io/v1/*`.

### 2.3 MCP tool names observed in bundle strings

```
list_art_styles
create_ai_video_v3
```

Rendered as a two-step agent trace: *"check which templates your workspace has"* →
*"ready to draw with the Stickman template"* → *"create ai video v3"*. Badge set on the
create call: `[template name, aspect ratio × resolution, duration, voice provider]`.

### 2.4 Aspect ratios

Only `"16:9"` and `"9:16"` appear as literals. API-level names are `landscape` / `portrait`.
No `1:1` was observed — treat square as our own addition, not parity.

### 2.5 Product copy that defines behaviour

From the FAQ, these are behavioural promises worth matching:

- Template cloning: reference video must be **≥ 30 seconds**, ~3 minutes gives the best result,
  must contain **spoken narration**, composed of stills or moving footage; explainers work best.
- Script limit: **50,000 characters** in the app; API V3 limits 30,000 (landscape) / 4,000 (portrait).
- Own voice: uploading a recording **transcribes it and uses it as-is**; no voice is generated over it.
- Failure handling: **retry resumes from the failed step**; completed voiceover/scenes/images are
  kept and **not charged again**.
- Programmatic use: `POST /v1/ai-videos-v3`, or MCP.

### 2.6 Pricing / plan structure (observed on `/pricing`)

| Tier | Price | Minutes/mo | Credits/mo | Top-up | Notes |
|---|---|---|---|---|---|
| Premium | $99 | ~81 | 27,500 | $1 / 275 cr | team collaboration |
| **Premium+** | **$199** | **~193** | **66,000** | **$1 / 330 cr** | "most popular", max $0.81/min |
| Max | $499 | ~616 | 206,000 | $1 / 412 cr | |

Credit unit costs (observed table):

| Service | Unit | Cost |
|---|---|---|
| AI images (AI video V3) | per 20 images | 250 credits |
| AI images (AI video V2) | per 20 images | (cheaper tier) |
| Image animation (V2/V3) | per 1 s | 6 credits |
| ElevenLabs v4 Turbo TTS | per 1,000 chars (~1 min audio) | 70 credits |
| ElevenLabs v4 TTS | per 1,000 chars | 140 credits |
| Vsub engine TTS | per 1,000 chars | 42 credits |
| Subtitle generation | per video | 20 credits |
| Video rendering | per 1 min | 10 credits |
| Standalone TTS API | per 1,000 chars | 100 credits |
| Fake-text screenshot | per image | 10 credits |

**Design note:** we reproduce the *shape* of this ledger (per-unit pricing, plan minutes,
top-ups) because it drives the API response contract, not because we intend to charge these
prices. Self-hosted default is "unlimited dev mode"; pricing is data, not code.

---

## 3. Documented contract (authoritative, public docs)

Base URL `https://api.vsub.io`. Auth: workspace-scoped bearer token, never expires, revoked
manually. MCP endpoint `https://api.vsub.io/mcp` (Streamable HTTP).

### 3.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/ai-videos-v3` | script/voiceover + `artStyleId` → video |
| POST | `/v1/ai-videos` | script + one of 16 `imageStyle` → video |
| POST | `/v1/roblox-videos` | rant over gameplay background |
| POST | `/v1/fake-text-videos` | chat conversation animated as video |
| POST | `/v1/quiz-videos` | quiz / multi-level trivia video |
| POST | `/v1/caption-videos` | transcribe + burn captions on an uploaded video |
| POST | `/v1/text-to-speech` | narration only → mp3 url |
| POST | `/v1/fake-text-screenshot` | chat as a still png |
| GET | `/v1/videos/:id` | status: `processing` → `rendering` → `completed` \| `failed` |
| POST | `/v1/videos/:id/render` | export mp4 (`format`, `frameRate`) |
| GET | `/v1/voices` | voice ids + metadata + preview mp3 |
| GET | `/v1/sound-effects` | sound effect library |
| GET | `/v1/background-videos` | gameplay/background library |
| GET | `/v1/caption-templates` | caption styles (negative id = built-in) |
| GET | `/v1/art-styles` | cloned styles + published ones |
| POST/GET | `/v1/files` | asset upload → key |
| GET | `/v1/workspace` | plan, credits, owner |
| GET | `/v1/credit-logs`, `/v1/balance-logs` | ledgers |
| — | webhooks | `webhookUrl` on create; at-least-once, 10 tries, 30 s → ~24 h |

### 3.2 Field defaults worth preserving (they encode product taste)

```
ai-videos-v3:  size=landscape, speed=standard, captions=false,
               voiceStyle={stability:50, similarityBoost:75, style:0, speed:100}
ai-videos:     imageStyle=CREEPY_COMIC, size=portrait, transition=smooth,
               voiceStyle={stability:38, similarityBoost:75, style:50, speed:100}
roblox:        voiceId=Adam, voicePitch=140, captionWordLimit=6, autoAddEmoji=true
text-to-speech: voiceId=Adam, voiceStyle.stability=38
render:        format=standard, frameRate=30  (10 cr/min @30, 20 cr/min @60)
```

16 V2 image styles: `CREEPY_COMIC, 90s_DISNEY, STUDIO_GHIBLI, ADULT_CARTOON, SIMPSONS,
CINEMATIC, CUTE_ANIME, ULTRA_REALISM, DARK_COMIC, B&W_COMIC, COMIC, SATIRICAL_2D, PIXAR,
18TH_CENTURY_HISTORICAL, POLISHED_CARTOON, COMIC_REALISM`.

Fake-text templates: `iphone, iphone-dark, whatsapp, whatsapp-dark, instagram,
instagram-dark, tinder, tinder-dark, cantina`.

Quiz: `template=standard|multi-levels`; image styles `CINEMATIC, ANIME, 3D, CINEMATIC_DARK,
ANIME_DARK, COMIC, CARTOON, PUNK, PSY`.

### 3.3 Internal step names (leaked by the status API)

`GET /v1/videos/:id` reports `step` values such as `create-scenes`, `create-vocal`,
`create image`, `render`. That is the observable shape of their pipeline and a good sanity
check on ours: our step ids are `create-scenes`, `create-vocal`, `create-images`,
`create-captions`, `render`.

---

## 4. What we deliberately did NOT do

- No login, no payment flow, no private endpoint calls.
- No decompilation of server code (not accessible).
- No reuse of their JS, copy, images, templates, sample videos, or voices.
- No attempt to defeat rate limits or paywalls.

## 5. What remains unknown (and why it doesn't block us)

| Unknown | Impact | Mitigation |
|---|---|---|
| Exact scene-splitting prompt/model | affects prose quality, not architecture | our own planner + deterministic fallback; quality is tunable |
| How art-style "learning" is implemented (LoRA? prompt synthesis? image refs?) | affects fidelity ceiling | we start with prompt+palette+character-bible lock; LoRA is a later upgrade path |
| Image model behind V3 | cosmetic | free `flux-1-schnell` first, swap behind a port |
| Voice model for "Vsub engine" | none | our edge-tts/IndicF5 stack is already better for Tamil |
| Editor internals | ux only | we design our own editor |

## 6. Evidence hygiene

- The bundle mirror lives outside the repo (temp dir) and is **not committed**.
- Findings are labelled observed/inferred throughout this doc.
- Any future runtime capture must be recorded as a new evidence record, not merged into the
  static claims above.
