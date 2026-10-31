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
| POST | `/v1/videos/:id/render` | `{format, frameRate, webhookUrl?}` → 409 if not terminal |

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
max-age=300`. Parity note: *"The list rarely changes, so cache it rather than calling it
before every video."*

### 2.4 Our additions `[+]`

| Method | Path | Why |
|---|---|---|
| POST | `/v1/videos/plan` | dry-run: scene split, est. duration, language plan. **No charge, no model call, no video row.** `adapter: "heuristic"`; `cost` lands with P6 (credits). |
| GET | `/v1/videos/:id/plan` | the stored plan + voice plan, for the editor inspector |
| POST | `/v1/videos/:id/scenes/:idx/redraw` | redraw one scene with an optional prompt nudge |
| POST | `/v1/videos/:id/narration` | re-narrate changed scenes only |
| GET | `/v1/videos/:id/captions` | `srt`, `vtt`, `ass`, `json` |
| POST | `/v1/art-styles` | upload reference video (multipart) → ffprobe validation (≥30s, has audio, ≤10min), stores file, inserts `art_style` row `status='building'`, returns `202 {id, status, createdAt}`. Build job enqueued asynchronously. |
| GET | `/v1/art-styles/:id/export` | portable style JSON `{version: 1, name, formats[], profile}` — the full `StyleProfile`, no ids/keys/timestamps; `409 conflict` while building, `404 not_found`, `400 invalid_request` (`field: "id"`), `500 internal` if the stored profile fails validation |
| POST | `/v1/voices/import` | consent-gated voice import |

None of these change the parity contract; they are additive.

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
- Unsigned mode available for parity; signing is on by default.

Delivery runs on its own pg-boss queue with `retryLimit=10` and a custom backoff schedule, so
a slow receiver never blocks a render.

---

## 4. MCP

**Endpoint:** `/mcp` (Streamable HTTP, JSON-RPC 2.0). Works with `Accept: application/json,
text/event-stream`.

### 4.1 Tool list (parity)

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
