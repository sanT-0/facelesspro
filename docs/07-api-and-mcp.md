# 07 — API and MCP surface

Two front doors, one implementation. **Every MCP tool is one HTTP endpoint** with identical
validation, identical cost, identical webhooks. If they ever diverge, the MCP layer is wrong.

Base URL (self-host): `${PUBLIC_BASE_URL}` · default `http://127.0.0.1:3001`
Parity base URL shape: `/v1/...`

---

## 1. Authentication

### 1.1 API keys `[P]`

```
Authorization: Bearer vp_<40 hex>
```

- Generated in Settings → API Keys; **shown once**, stored as `sha256`.
- Workspace-scoped, never expires, revocable immediately.
- Revocation is irreversible; rotate by issuing a new key.
- Middleware `withWorkspace()` resolves key → workspace and is the only place scoping happens.

`withWorkspace()` also enforces two fixed one-minute windows: `RATE_LIMIT_KEY_PER_MINUTE`
(default 60) per key and `RATE_LIMIT_WORKSPACE_PER_MINUTE` (default 300) per workspace. Either
limit rejects with `429 rate_limited` and `Retry-After: <seconds>`; rejected requests do not
extend the window. Counters live in the api process, so a multi-process deployment needs a shared
limiter before it can rely on these numbers.

### 1.2 Errors `[P]`

```jsonc
{ "error": { "code": "invalid_request", "message": "artStyleId is required", "field": "artStyleId" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `invalid_request` | schema/validation, bad size for style, both/neither script+voiceover |
| 401 | `unauthorized` | missing/bad/revoked key |
| 402 | `insufficient_credits` | ledger would go negative (paid mode only) |
| 403 | `forbidden` | plan/resolution not allowed, member role too low |
| 404 | `not_found` | video/style/file |
| 409 | `conflict` | render while `processing`/`rendering` |
| 413 | `payload_too_large` | upload/voiceover over cap |
| 422 | `unprocessable` | accepted syntax, impossible request (0-minute video) |
| 429 | `rate_limited` | per-key/workspace limit, `Retry-After` |
| 502 | `upstream_failed` | all adapters in a chain failed |
| 500 | `internal` | unexpected failure; message is generic, details stay in logs |

---

## 2. Endpoints

### 2.1 Create

| Method | Path | Body highlights |
|---|---|---|
| POST | `/v1/ai-videos-v3` | `artStyleId*`, `script`\|`voiceoverUrl`, `size`, `speed`, `voiceId`, `voiceStyle`, `captions`, `captionTemplateId`, `render`, `webhookUrl` |
| POST | `/v1/ai-videos` | `script*`, `imageStyle`, `size`, `transition`, `voiceId`, `voiceStyle`, `render`, `webhookUrl` |
| POST | `/v1/quiz-videos` | `items*[]`, `template`, `language`, `voiceId`, `answerTemplate`, `generateBackgroundImage`, `backgroundImagePrompt`, `generateQuestionImage`, `imageStyle`, `render`, `webhookUrl` |
| POST | `/v1/fake-text-videos` | `conversations*[]`, `backgroundVideoId`, `backgroundVideoStartFrom`, `render`, `webhookUrl` |
| POST | `/v1/roblox-videos` | `script*`, `voiceId`, `voicePitch`, `captionWordLimit`, `autoAddEmoji`, `backgroundVideoId`, `render`, `webhookUrl` |
| POST | `/v1/caption-videos` | multipart `file` \| json `url`, `templateId`, `render`, `webhookUrl` |
| POST | `/v1/text-to-speech` | `text*`, `voiceId`, `voiceStyle` |
| POST | `/v1/fake-text-screenshot` | conversation payload → png |

All create responses are identical in shape:

```jsonc
{ "id": "uuid", "status": "processing", "render": false,
  "createdAt": "2026-08-05T09:20:11.000Z", "editorUrl": "…/editor?id=uuid" }
```

### 2.2 Read / act

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/videos/:id` | `{status, step, videoUrl?, error?, editorUrl, createdAt, ...}` |
| POST | `/v1/videos/:id/render` | `{resolution?, frameRate?, format?, webhookUrl?}` → `202` + `videoResponseSchema`; `409` unless `completed` |

`GET /v1/videos/:id` returns exactly `videoResponseSchema` (the same object webhooks carry). The
stored render key is rewritten to an absolute URL through `PUBLIC_BASE_URL` + the api's stable
`/files/*` prefix; an absolute stored value is passed through. `error` is `null` until a step
fails, `step` then names the resume point, and `editorUrl` is `<base>/editor?id=<id>`. `videoUrl`
is mandatory once `status=completed`: a completed row without a render is a `500`, not a video the
client can never download. `thumbnailUrl` is not populated yet because the pipeline has no
video→thumbnail link; `scenes` stays absent here (the inspector uses `/v1/videos/:id/plan`).

`POST /v1/videos/:id/render` accepts `{}` (render with the documented defaults: 1080p / 30 fps /
`standard`), any subset of `resolution`, `frameRate`, `format`, and an optional https `webhookUrl`.
Unknown fields, `720`, a frame rate other than 30/60 and non-https webhooks are `400
invalid_request` with `field`. Only a `completed` video is renderable: `processing`, `rendering` and
`failed` are `409 conflict`. Success is `202` with the same `videoResponseSchema` as `GET`, now
`status: "rendering"`, `step: "render"`; the previous `videoUrl` remains until the step replaces
the MP4. `webhookUrl`, when supplied, replaces the stored callback. The guarded transition and the
`render` enqueue share one transaction, so a `202` always means exactly one queued job and a `409`
changed nothing. Unknown id → `404`, non-UUID → `400` with `field: "id"`, malformed JSON → `400`
`request body must be JSON`.

### 2.3 Libraries

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/voices` | `voices[]` (id, name, description?, gender?, accent?, age?, useCase?, previewUrl?) + our `languages[]`, `mixesEnglish` |
| GET | `/v1/art-styles` | `styles[]` (id, name, published, formats[], previewUrl, portraitPreviewUrl, sampleVideoUrls[], status, createdAt) — ready rows only; preview and sample storage keys are rewritten to `/files/*`, absolute URLs are passed through |
| GET | `/v1/caption-templates` | `templates[]` (id, name, spec) |
| GET | `/v1/sound-effects` | built-ins + uploaded |
| GET | `/v1/background-videos` | gameplay/background library |
| POST | `/v1/files` | multipart upload → `{key, url, bytes, mime}` |
| GET | `/v1/workspace` | `{id, name, plan, credits, owner}` |
| GET | `/v1/credit-logs` | movements with `videoId` |
| GET | `/v1/balance-logs` | top-ups / charges |

Caching: libraries are slow-changing; responses carry `ETag` and `Cache-Control: private,
max-age=300`. A matching `If-None-Match` returns `304`; cache a list rather than calling it
before every video.

### 2.4 Our additions `[+]`

| Method | Path | Why |
|---|---|---|
| POST | `/v1/videos/plan` | dry-run: scene split, est. duration, language plan. **No charge, no model call, no video row.** `adapter: "heuristic"`; `cost` lands with P6 (credits). |
| GET | `/v1/videos/:id/plan` | the stored plan + voice plan, for the editor inspector |
| POST | `/v1/videos/:id/scenes/:idx/redraw` | redraw one scene with an optional prompt nudge |
| POST | `/v1/videos/:id/narration` | re-narrate changed scenes only |
| GET | `/v1/videos/:id/captions` | `srt`, `vtt`, `ass`, `json` |
| POST | `/v1/videos/:id/retry` | re-enqueue the step recorded on a `failed` video; `409` unless `failed`; no charge of its own |
| POST | `/v1/art-styles` | upload reference video (multipart) → ffprobe validation (≥30s, has audio, ≤10min), stores file, inserts `art_style` row `status='building'`, returns `202 {id, status, createdAt}`. Build job enqueued asynchronously. |
| GET | `/v1/art-styles/:id/export` | portable style JSON `{version: 1, name, formats[], profile}` — the full `StyleProfile`, no ids/keys/timestamps; `409 conflict` while building, `404 not_found`, `400 invalid_request` (`field: "id"`), `500 internal` if the stored profile fails validation |
| POST | `/v1/voices/import` | consent-gated voice import |

None of these change the committed contract; they are additive.

`POST /v1/videos/:id/retry` accepts only a `failed` video with a recorded `step`. It clears
`error`, re-enqueues that one step and returns `202` + `videoResponseSchema`: `rendering` for a
failed `render`, otherwise `processing`. Earlier steps keep their artifacts and ledger rows; the
resumed step is the only work and owns its charge, so a retry writes no ledger row itself.
`processing`/`rendering`/`completed` → `409 conflict`, unknown id → `404`, non-UUID → `400` with
`field: "id"`.

`GET /v1/videos/:id/captions` will serve the stored sidecar selected by format. All four are
serialized from one persisted cue track; JSON is the strict v1 document from
`captionJsonExportSchema`, while the database-only cue shape is the same document without each
cue's one-based export index. Paths, asset rows and storage keys never appear in JSON.

### 2.5 API keys

| Method | Path | Body / returns |
|---|---|---|
| POST | `/v1/keys` | `{name}` → `201 {key, apiKey}` — the **only** response that contains the secret |
| GET | `/v1/keys` | `{keys: apiKey[]}` — active and revoked rows for the caller's workspace |
| DELETE | `/v1/keys/:id` | revoke → `200 {apiKey}`; idempotent |

`apiKey` is exactly `{id, name, prefix, lastUsedAt, revokedAt}`. `prefix` is the first 11
characters (`vp_` + 8 hex) so Settings can identify a key without the secret; `lastUsedAt` and
`revokedAt` are ISO timestamps or `null`. Neither `hash` nor `workspace_id` is ever on the wire.

Every `/v1/keys` route requires `Authorization: Bearer vp_<40 hex>`. A missing, malformed,
unknown or revoked key is `401 unauthorized` with `WWW-Authenticate: Bearer`; the response does
not distinguish the cases. Scoping comes only from `withWorkspace()`: create/list/revoke never
accept a workspace id from the request, and another workspace's id is `404 not_found`.
`POST` accepts a non-blank `name` (trimmed, ≤100 chars); anything else is `400 invalid_request`
with `field: "name"`. `DELETE` requires a UUID (`400`, `field: "id"`), and a repeat `DELETE`
returns the original `revokedAt` rather than inventing a conflict. `lastUsedAt` is refreshed at
most once per 60 seconds so authentication stays read-mostly.

Because `POST /v1/keys` already needs a key, the first key is minted on the host:

```bash
npm run key:create -- --name "CI renderer" [--workspace <uuid>]
```

It prints the key once. Only `sha256(key)` is stored; there is no recovery path, only rotation
by issuing a new key and revoking the old one. Create the replacement **before** revoking the
last active key: `/v1/keys` needs a key, so revoking the only one locks the workspace out of key
management until `npm run key:create` is run on the host again.

---

## 3. Webhooks `[P]` `[+]`

```jsonc
POST {webhookUrl}
Headers: Content-Type: application/json
         X-Faceless-Event-Id: evt_uuid
         X-Faceless-Signature: t=1690000000,v1=<hmac_sha256(secret, t + "." + body)>   [ours]
Body:    { "event": "completed", "video": { …identical to GET /v1/videos/:id… } }
```

- HTTPS only; `http://` and localhost rejected at create time.
- 10 attempts: 30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 8 h, 8 h (≈24 h total).
- Any 2xx within 10 s = delivered. Body ignored. Non-2xx/timeout/DNS/TLS = failure.
- Dedupe on `X-Faceless-Event-Id`.
- Render finishing fires **again**, even if generation already notified.
- Unsigned mode available for compatibility; signing is on by default.

Delivery runs on its own pg-boss queue with `retryLimit=10` and a custom backoff schedule, so
a slow receiver never blocks a render.

---

## 4. MCP

**Endpoint:** `/mcp` (Streamable HTTP, JSON-RPC 2.0). Works with `Accept: application/json,
text/event-stream`.

### 4.1 Tool list (1:1 with the `/v1` routes)

```
create_caption_video       write    spend
create_ai_video_v3         write    spend
create_ai_video            write    spend
create_quiz_video          write    spend
create_roblox_video        write    spend
create_fake_text_video     write    spend
read                       read
render_video               write    spend
upload_file                write
list_voices                read
list_sound_effects         read
list_background_videos     read
text_to_speech             write    spend
create_fake_text_screenshot write   spend
list_caption_templates     read
list_art_styles            read
get_workspace              read
list_credit_logs           read
list_balance_logs          read
```

Behaviour rules `[P]`:
- A tool failure returns **error text**, not a JSON-RPC protocol error — the assistant can fix
  its arguments and try again.
- Create tools return immediately with `processing`; the assistant calls `read` later or passes
  `webhookUrl`.

### 4.2 Our extra tools `[+]`

```
plan_video                 read    no charge — cost/duration/scene estimate
preview_script_split       read    show how a script would be split, with language tags
list_languages             read    narration languages + whether a mixed pair exists
```

### 4.3 OAuth 2.1 `[P]`

```
GET  /.well-known/oauth-protected-resource        RFC 9728
GET  /.well-known/oauth-authorization-server      RFC 8414
POST /oauth/register                              RFC 7591 DCR, no secret, https or localhost redirect
GET  /oauth/authorize                             consent + workspace pick, PKCE S256 required
POST /oauth/token                                 code → access (12 h) + refresh (90 d, rotating)
POST /oauth/revoke                                RFC 7009, both halves die together
```

- `401` on `/mcp` includes
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
- Static-header clients may send `Authorization: Bearer vp_…` instead of OAuth.
- Token scope = one workspace, chosen at consent.

### 4.4 Example

```bash
curl -X POST "$BASE/mcp" \
  -H "Authorization: Bearer $FACELESS_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"create_ai_video_v3",
        "arguments":{
          "script":"இன்னைக்கு நாம பாக்கப் போறது, the biggest mistake freelancers make.",
          "artStyleId":"<uuid>",
          "size":"portrait",
          "render":{}
        }}}'
```

---

## 5. Compatibility statement

We implement the **same paths, same field names, same defaults, same status machine** for the
documents in [01](./01-product-spec.md). That is a compatibility goal, not a claim of
affiliation. Two deliberate deviations, both additive and documented:

1. `videoId`/`artStyleId`/`voiceId` accept Tamil/English mixed inputs naturally; no extra
   parameters needed.
2. Webhook bodies are signed by default.

Anything else that differs will be listed here as it is discovered.
