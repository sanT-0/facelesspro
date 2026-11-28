# START HERE — run FacelessPro locally

Everything below runs in Docker. You do **not** need Node, Python, ffmpeg or any API key on the
host — only Docker with Compose v2.

The `npm run …` lines are thin shortcuts. If you do not have Node/npm on the host, run the
`docker compose …` command shown next to them; nothing else changes.

---

## 1. First run (two commands)

```bash
cp .env.example .env      # defaults work; fill in API keys later, if you want them
npm run up                # = docker compose up -d --build
```

The first build takes roughly 4 minutes. After that, `npm run up` is incremental and starts in
seconds.

Check that everything came up:

```bash
npm run status            # = docker compose ps — every service should say (healthy)
curl localhost:3001/health   # {"status":"ok","db":"ok","queue":"ok"}
curl localhost:3003/health   # {"status":"ok","service":"facelesspro-web"}
```

If a service is not `(healthy)`, read its log (replace `worker` with the service name):

```bash
docker compose logs --tail=100 worker
```

---

## 2. Open the app

| What | URL | Notes |
|---|---|---|
| **Studio (start here)** | <http://localhost:3003> | the web app; proxies `/v1/*` and `/files/*` to the api |
| API | <http://localhost:3001> | `/health`, `/v1/*`, `/files/*` |
| API health | <http://localhost:3001/health> | `200` only when db + queue are ok |
| Media service | <http://localhost:8000/health> | TTS/ASR; shows the active engine |
| MCP server | <http://localhost:3002/mcp> | Streamable HTTP endpoint |
| Postgres | `localhost:5433` | user `faceless`, password `faceless`, db `faceless` |

The studio is the only URL you need in a browser. Completed videos are served from
`http://localhost:3003/files/...`, which is why `PUBLIC_BASE_URL` in `.env` is set to the studio
origin (`http://localhost:3003`), not the api port.

---

## 3. Create your first API key

The studio and every `/v1` route need a key. Mint the first one from inside the api container:

```bash
npm run key -- --name "local"
# without host npm:
docker compose exec -T api node_modules/.bin/tsx packages/db/src/create-api-key.ts --name "local"
```

It prints `vp_` + 40 hex characters **once**. Copy it; only its hash is stored.

---

## 4. Make a video

In the studio: open <http://localhost:3003>, paste a script, pick an art style, press create.

Or through the API (the default build is the free path: heuristic planner, procedural images,
edge-tts narration):

```bash
KEY=vp_...                                   # the key from step 3

# optional: see the seeded art styles and their ids
curl -H "Authorization: Bearer $KEY" localhost:3001/v1/art-styles

# create a video (captions on, 1080p render is the default)
curl -X POST localhost:3001/v1/ai-videos-v3 \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{
    "artStyleId": "00000000-0000-4000-8000-000000000101",
    "script": "வணக்கம்! This is my first FacelessPro video.",
    "size": "landscape",
    "captions": true
  }'

# poll it — status goes processing → rendering → completed (or failed)
curl -H "Authorization: Bearer $KEY" localhost:3001/v1/videos/<id>
```

The response carries `editorUrl` (open it in the browser) and, once completed, `videoUrl`.
A short video takes well under a minute on the free path.

---

## 5. Stop, start again, reset

| I want to… | Command | What it does |
|---|---|---|
| stop everything, keep my data | `npm run down` | `docker compose down` — database and renders survive |
| start again | `npm run up` | rebuilds changed code, keeps data |
| start without rebuilding | `docker compose up -d` | fastest restart |
| wipe everything and start clean | `npm run reset` | `docker compose down -v` — **deletes the database, API keys and all renders** |
| check what is running | `npm run status` | `docker compose ps` |
| follow all logs | `npm run logs` | Ctrl-C stops following, not the stack |
| follow one service | `docker compose logs -f worker render` | useful while a video is processing |
| restart one service | `docker compose restart worker` | keeps its volumes |
| open a shell in a container | `docker compose exec api sh` | |

Named volumes hold the state: `pgdata` (database), `data` (renders/uploads), `media-data` (audio).
`npm run down` keeps all three; `npm run reset` deletes all three.

---

## 6. After changing configuration

| Change | What to run |
|---|---|
| `.env` values (API keys, engine chains) | `docker compose up -d` — no rebuild |
| TypeScript/Python source | `npm run up` |
| `docker-compose.yml` | `docker compose up -d --build` |

Empty credentials are fine: the engine chains skip a provider with no key and end on a free
adapter. `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` are the only keys needed for a **public**
deployment (licensed TTS); see [`.env.example`](./.env.example) and
[docs/10-operations.md](./docs/10-operations.md) §3.

Ollama and ComfyUI run on the **host** and are reached through `host.docker.internal`; they are
optional. See [docs/10-operations.md](./docs/10-operations.md) §1.

---

## 7. Common problems

| Symptom | Cause / fix |
|---|---|
| `port is already allocated` | Something else owns 3001, 3002, 3003, 5433 or 8000. Stop it, or change the host side of the mapping in `docker-compose.yml`. |
| a service stays `unhealthy` | `docker compose logs --tail=200 <service>`; the api logs the failing dependency (`db`, `queue`). |
| first video sits on `create-scenes` for minutes | The planner chain is waiting on a host LLM. Set `PLANNER=heuristic` in `.env` for the fast free path, then `docker compose up -d worker`. |
| `editorUrl` / `videoUrl` does not open | `PUBLIC_BASE_URL` must be the origin you open (`http://localhost:3003` for compose). Change it in `.env` and run `docker compose up -d`. |
| images look like flat gradients | Expected on the free path (`procedural`). Add a Cloudflare/Pollinations key or run ComfyUI to upgrade them. |
| no narration audio | `docker compose logs -f media`; the free engine is edge-tts, which needs outbound network. |
| I lost my API key | Keys are shown once. Mint a new one with `npm run key -- --name "replacement"`. |
| I want a clean slate | `npm run reset`, then `npm run up`, then mint a key again. |

---

## Host development (no Docker for the app)

Hot reload, tests and the media service outside Docker are documented in
[docs/10-operations.md](./docs/10-operations.md) §1. In short:

```bash
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev:api       # :3001
npm run dev:worker
npm run dev:web       # :3000 — open this
```

For host dev, set `PUBLIC_BASE_URL=http://localhost:3000` in `.env` so links point at the dev
studio.
