# 07 — API and MCP surface

Two front doors, one implementation. **Every MCP tool is one HTTP endpoint** with identical
validation, identical cost, identical webhooks. If they ever diverge, the MCP layer is wrong.

Base URL (self-host): `${PUBLIC_BASE_URL}` · default `http://localhost:3003` in the compose stack
(the studio origin, which proxies `/v1/*` and `/files/*` to the api). Calling the api directly on
`:3001` works for requests but returns links on `${PUBLIC_BASE_URL}`.
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

Every `/v1` route mounts the same middleware; there is no unauthenticated `/v1` surface. Reads
and transitions are scoped to the key's workspace, and an id from another workspace is
`404 not_found`, never `403 forbidden`: knowing a UUID must not reveal that it exists. Art-style
lookups follow the same rule — published styles are global, unpublished rows are visible only to
their workspace.

### 1.1a Public artifacts `[P]`

`GET /files/<key>` serves one stored artifact without a key. It is the **only** unauthenticated
prefix: renders, stills, art-style previews and TTS clips all resolve to it, and the key is a
server-generated path relative to `DATA_DIR` — a client filename never enters the URL. The
response carries the artifact's real `Content-Type`, supports `HEAD` and a single `Range`
(`206` + `Content-Range`, so a `<video>` can seek), and `404` for a missing key. The handler
rejects `..`, `//` and backslashes before touching the filesystem, so a traversal cannot name a
file outside the root. Because these bytes are byte-identical to whatever a workspace produced,
a private deployment may sit this prefix behind its own access proxy; the building blocks are a
bucket/CDN swap (docs/10), not extra auth.

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
| POST | `/v1/ai-videos-v3` | `artStyleId*`, `script`\|`voiceoverUrl`, `size`, `speed`, `voiceId`, `voiceStyle`, `captions`, `captionTemplateId`, `captionSpec`, `render`, `webhookUrl` |
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

`POST /v1/ai-videos-v3` and `POST /v1/ai-videos` are implemented. Both validate their contract,
reject a wordless script with `invalid_request`/`field: "script"`, and share one submit
transaction (row insert + `create-scenes` enqueue). V2 applies its documented preset,
`size=portrait`, `transition=smooth`, `voiceStyle={stability:38, similarityBoost:75, style:50,
speed:100}` and always-on captions; V3 resolves `artStyleId` and keeps captions opt-in. `render`
is optional on both: omitting it completes an editable project without an mp4. The remaining
templates in the table are still `[P]`.

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
video→thumbnail link. `scenes`, `voicePlan` and `narrationUrl` are populated once their steps
have committed — `scenes` ordered by `idx` with each still's public `imageUrl`, `voicePlan` the
stored narration plan (`runs` name the Tamil vs English routing), and `narrationUrl` the public
`/files/*` URL of the narration master (so the editor can draw a waveform without a second
route). All three keys stay absent before that, so an editor can poll the one endpoint and does
not need a second inspector route.

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
| GET | `/v1/videos/:id/plan` | `{plan, voicePlan}` — the stored split + narration routing, for the editor inspector |
| POST | `/v1/videos/:id/scenes/:idx/redraw` | redraw one scene with an optional prompt nudge |
| POST | `/v1/videos/:id/narration` | re-narrate changed scenes only |
| GET | `/v1/videos/:id/captions` | `srt`, `vtt`, `ass`, `json` |
| POST | `/v1/videos/:id/captions/preview` | regroup the stored word timings with `{templateId?, spec?}` → the same versioned JSON document; no write, no charge |
| POST | `/v1/videos/:id/captions` | save a caption style and rebuild the track + MP4; completed captioned V3 only |
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

`GET /v1/videos/:id/captions?format=srt|vtt|ass|json` (default `srt`) re-serializes the one
persisted cue track. SRT/VTT/JSON cannot drift from the burned-in captions because they are built
from the same rows, and JSON is exactly `captionJsonExportSchema`. An unknown `format` is `400
invalid_request` with `field: "format"`; an unknown video is `404 not_found`; a video whose
`create-captions` step has not committed is `404 not_found` with `captions not available`; a
stored track that no longer validates is a fixed `500 internal`. Responses carry the sidecar
`content-type`, an inline `captions.<format>` filename and `Cache-Control: private, max-age=300`
(parity with caption templates). ASS is written on the same 1080p design canvas the worker used
(libass scales it to 2K/4K) and takes the stored template's style when that template still
exists; otherwise `buildAss` defaults apply. Paths, asset rows and storage keys never appear.

`POST /v1/videos/:id/captions/preview` accepts `{templateId?, spec?}` and returns the same
`captionJsonExportSchema` document for the **stored** narration word timings regrouped with the
given template/spec. The request spec is merged over the template spec, so the editor can try a
word limit or emoji without saving a template. Nothing is written and no ledger row exists — a
preview is free. An unknown explicit `templateId` is `400 invalid_request` (`field:
"templateId"`), an unknown video is `404 not_found`, and a video whose `create-vocal` step has not
committed is `404 not_found` with `captions not available`.

`POST /v1/videos/:id/captions` accepts the same `{templateId?, spec?}` shape and **saves** it:
`templateId` replaces the stored request's `captionTemplateId` and `spec` replaces its
`captionSpec`. The body is the complete choice, not a patch — omitting `spec` clears the
per-video override, so a template-only save uses that template's own spec. At least one of the
two keys is required; `{}` or `{spec: {}}` would not change anything, so it is `400
invalid_request` with `field: "templateId"`. An unknown explicit template is also `400` with
`field: "templateId"`. The transition is allowed only on a `completed` AI-video V3 project with
`captions: true`: other statuses are `409 conflict` (`video is <status>`), and a video with
captions off or another kind is `409 conflict` (`video has no captions`). Inside the row lock
the request is rewritten, the video moves to `processing`/`create-captions` and that step is
enqueued in the same transaction; the `202` returns the same `videoResponseSchema` as `GET`. The
worker merges the saved spec over the template, rewrites the four sidecars and ASS, and — when
the request carried `render` — queues `render`, so the MP4 is rebuilt with the new style while
audio and artwork are untouched. Unknown video → `404 not_found`; non-UUID id / malformed body →
`400 invalid_request`.

`GET /v1/videos/:id/plan` returns `{plan, voicePlan}`. `plan` is the stored `scenePlanSchema`
document: the split `create-scenes` committed, including `adapter`/`degradedFrom`. `voicePlan` is
the same narration routing `GET /v1/videos/:id` returns, or `null` until `create-vocal`. An
unknown video is `404 not_found`; a video before `create-scenes` is `404 not_found` with `plan not
available`; a stored plan that no longer validates is a fixed `500 internal`.

`POST /v1/videos/:id/scenes/:idx/redraw` accepts `{}` or `{prompt?}` (≤500 characters) and
regenerates exactly one still of a **completed** video. `prompt` is a nudge appended to the stored
scene prompt, never a replacement: the planner's composition and the style negative clause still
apply, and the combined prompt is cut to the image-prompt ceiling rather than rejected. The
one-scene marker lives on the row (`video.redraw = {sceneIdx, prompt?}`) and the `create-images`
job is enqueued in the same transaction, so a `202` always means exactly one queued job;
`processing`, `rendering` and `failed` are `409 conflict` (a failure is resumed with `retry`). The
step draws only that scene, compares it against the other scenes' histograms, replaces its
`frames/manifest.json` entry and `scene.image_asset_id`, writes one `image` ledger row, clears the
marker and moves the video to `rendering`/`render`; captions and narration are untouched, so
`concat(scenes.text)` and the word timings do not change. Unknown video or scene index → `404
not_found`, non-UUID id / non-integer or out-of-range `idx` / blank or over-long prompt / unknown
body key → `400 invalid_request` with `field`.

`POST /v1/videos/:id/narration` accepts `{scenes: [{idx, text}]}` — only the scenes whose text
changed, at least one, unique indexes, each text 1..50,000 characters after trimming. It is a
**completed** video only; `processing`/`rendering`/`failed` are `409 conflict`, and so are a video
whose narration is an uploaded voiceover (text cannot change that audio) and a stored video that
is not an AI-video V3 project (no scene text to edit). The transition updates
the scene rows, the stored request `script` and the plan in one transaction, records the changed
indexes in `video.revocal`, moves the video to `processing`/`create-vocal` and enqueues that step;
a `202` returns the same `videoResponseSchema` as `GET`. Sending only identical text is `400
invalid_request` with `field: "scenes"` — nothing changed, so nothing is queued or charged — and an
edited script that no longer fits the stored request is also `400 invalid_request` with
`field: "scenes"`. Unknown video or scene index → `404 not_found`; non-UUID id / empty list /
duplicate index / blank or over-long text / unknown key → `400 invalid_request` with `field`. The
worker charges TTS units for the changed scenes only; unchanged scenes are media-cache hits.

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

### 2.6 Workspace members `[+]`

Roles, strongest first: `owner` > `admin` > `editor` > `viewer`. A workspace always has one
owner, and `seats` counts every member including the owner.

| Method | Path | Body / returns |
|---|---|---|
| GET | `/v1/workspace/members` | `{members: member[]}` |
| POST | `/v1/workspace/members` | `{email, role?}` → `201 {member}`; role defaults to `editor` |
| PATCH | `/v1/workspace/members/:id` | `{role}` → `200 {member}` |
| DELETE | `/v1/workspace/members/:id` | → `200 {removed: true}` |

`member` is `{id, workspaceId, userId, email, name, role, joinedAt}`. `id` is the user id — the
membership table is keyed by `(workspace_id, user_id)` — so the `:id` path parameter is the same
value as `userId`. `joinedAt` is currently the user's account creation time, because the
membership row has no timestamp of its own; a per-membership `joinedAt` is a follow-up.

Rules, enforced in `@facelesspro/db` and pinned by `members.db.test.ts`:

- Inviting needs `owner` or `admin`; changing a role needs `owner`; removing needs `owner` or
  `admin`. Anything lower is `403 forbidden`. A key minted before `api_key.user_id` existed
  cannot prove a role and is refused rather than treated as the owner.
- `POST` refuses `role: "owner"` (`400 invalid_request`); ownership transfer is a separate
  operation. Inviting an existing member is `409 conflict`.
- The owner can never be demoted or removed, and an admin cannot remove another admin.
- A member cannot change their own role or remove themselves.
- Adding a member is `403 forbidden` once the plan's seats are full (`current >= seats`).
  `seats` is a plain number for every plan, including `selfhost`, so the same check applies.

An email that matches no user creates a password-less `user` row so the invite can be repeated
without duplicating anyone. Sending an actual invitation email is P6 scope; this route does not
promise delivery. Roles gate team management only — video routes remain workspace-scoped, so any
member's key can submit work until per-role video capability lands.

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
GET  /oauth/authorize                             consent (workspace API key), PKCE S256 required
POST /oauth/token                                 code → access (12 h) + refresh (90 d, rotating)
POST /oauth/revoke                                RFC 7009, both halves die together
```

- `401` on `/mcp` includes
  `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
- Static-header clients may send `Authorization: Bearer vp_…` instead of OAuth.
- **Consent proves the workspace with an API key.** The consent form asks for a
  `vp_…` key; the MCP server validates it through the API (`GET /v1/workspace`) and
  stores the workspace id from the response. A client-supplied workspace id is never
  trusted, and there is no workspace picker.
- **Token scope = one workspace.** The pair records the validated `vp_…` key; a tool
  call forwards that key to `/v1`, never the `at_…` token.
- Authorization codes are server-generated, single-use and expire in 10 minutes.
  A failed PKCE check burns the code.
- PKCE is S256 only; `code_challenge` is required on authorize and `code_verifier`
  is required on exchange. The verifier is compared in constant time.
- Refresh rotation replaces the whole session: the old access token dies with the
  old refresh token.
- Revocation by either the access or refresh token kills the session's other half.
- Static `vp_…` keys are validated against `GET /v1/workspace`; the MCP server does
  not maintain its own key list.
- OAuth state (clients, codes, tokens) is **in memory** for now. A restart invalidates
  it; clients re-run DCR + consent. Postgres persistence is a follow-up.
- The in-memory store is bounded: expired codes and tokens are swept on every write,
  and the client/code/token maps evict their oldest entry at 10k/10k/100k
  (configurable). Unauthenticated DCR therefore cannot grow memory without limit.


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
