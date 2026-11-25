# FacelessPro

[![CI](https://github.com/sanT-0/facelesspro/actions/workflows/ci.yml/badge.svg?branch=development)](https://github.com/sanT-0/facelesspro/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](package.json)

AI faceless video studio — script in, illustrated narrated video out, in a style cloned from
a reference video. Built to run on free engines, with **Tamil + English code-mixed narration**
as a first-class citizen.

> Work in progress, built one roadmap task at a time. What is actually true today lives in
> [docs/PROGRESS.md](./docs/PROGRESS.md), not in this file.

## What it does

1. You paste a script (or upload a voiceover).
2. It splits the script into scenes.
3. It narrates the script — Tamil, English, or a natural mix — with word-level timing.
4. It draws every scene in an art style learned from a reference video you supplied.
5. It burns captions, composes the timeline, and exports 1080p / 2K / 4K, 16:9 or 9:16.
6. Everything is available over a REST API and an MCP server, so an AI assistant can create
   the video for you.

## Quick start

Requires Docker with Compose. Nothing else — no host Node, Python or ffmpeg:

```bash
git clone https://github.com/sanT-0/facelesspro.git
cd facelesspro
cp .env.example .env

docker compose up -d --build          # 7 services; first boot migrates + seeds
docker compose ps                     # wait for every service to be (healthy)
curl localhost:3001/health            # {"status":"ok","db":"ok","queue":"ok"}

# mint the first API key inside the api container
docker compose exec -T api node_modules/.bin/tsx \
  packages/db/src/create-api-key.ts --name "local"
```

Then open <http://localhost:3003> for the studio, or drive the API directly:

```bash
KEY=vp_...                            # printed once by the command above
curl -X POST localhost:3001/v1/fake-text-videos \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  --data-binary @request.json
curl -H "Authorization: Bearer $KEY" localhost:3001/v1/videos/<id>
```

`docker compose down -v` resets the database and artifacts; `docker compose logs -f worker`
follows a job. A cold build takes about 4 minutes on eight threads, and the first Fake Text
video completes in well under the 15-minute launch gate.

Host development (hot reload, `npm run gate`, the media service outside Docker) is documented in
[docs/10-operations.md](./docs/10-operations.md) §1.

## Documentation

| Doc | What it covers |
|---|---|
| [plan.md](./plan.md) | Goals, scope, stack, phases, gates, definition of done |
| [docs/01-product-spec.md](./docs/01-product-spec.md) | Feature-by-feature spec and API field contract |
| [docs/02-reverse-engineering.md](./docs/02-reverse-engineering.md) | How a reference product was analysed — evidence, what was and wasn't observed |
| [docs/03-architecture.md](./docs/03-architecture.md) | Services, data model, ports/adapters, storage, queue |
| [docs/04-pipeline.md](./docs/04-pipeline.md) | Step-by-step generation pipeline, artifacts, resumability |
| [docs/05-tts-tamil-mixed.md](./docs/05-tts-tamil-mixed.md) | The Tamil/English/Tanglish narration design |
| [docs/06-free-sources.md](./docs/06-free-sources.md) | Free engine matrix, limits, how to swap or upgrade |
| [docs/07-api-and-mcp.md](./docs/07-api-and-mcp.md) | `/v1` endpoints, auth, webhooks, MCP tools |
| [docs/08-testing.md](./docs/08-testing.md) | The code → test → next discipline and test matrix |
| [docs/09-roadmap.md](./docs/09-roadmap.md) | Phase-by-phase task list with acceptance criteria |
| [docs/10-operations.md](./docs/10-operations.md) | Running it, limits, cost control, troubleshooting |
| [docs/11-legal-and-compliance.md](./docs/11-legal-and-compliance.md) | Licences, voice consent, platform policy, what not to copy |
| [docs/12-maintaining.md](./docs/12-maintaining.md) | How a PR is verified, and the repo settings that make it stick |
| [docs/PROGRESS.md](./docs/PROGRESS.md) | Living checklist of what is actually done |

## Repository layout

```
apps/api            Hono HTTP API (v1) + MCP transport
apps/worker         job runner (pg-boss consumers), all five pipeline steps
apps/render         dedicated render consumer (RENDER_SERVICE=true)
apps/web            studio SPA, esbuild bundle served by nginx
apps/mcp            MCP server
packages/core       pure TS: segmentation, scene math, captions, pricing, timelines
packages/contracts  zod schemas shared by api, worker, web, mcp
packages/db         Drizzle schema, migrations, seed, prepareDatabase()
packages/queue      pg-boss definitions and enqueue helpers
packages/art        ffmpeg/resvg adapters + bundled Noto fonts (Tamil, Latin, emoji)
services/media      FastAPI: TTS, ASR, art-style extraction, image generation
docs                everything in the table above
```

## Status

| Phase | State |
|---|---|
| Docs & plan | ✅ done |
| P0 foundation | ✅ closed — `@facelesspro/*` workspaces, contracts, pure core, boundary lint, CI (Node 22 + Python 3.12) |
| P1 Tamil/English TTS | 🟡 13/15 — all 35 gate clips approved by ear; five voices; listening gate for real narration in generated videos still open |
| P2 scene planner | ✅ closed — splitter, duration estimate, scene packing, provider planner chain + heuristic floor, `POST /v1/videos/plan` |
| P3 art style + images | ✅ checklist complete — style build + previews, four image adapters, ordered chain, palette correction, cross-scene consistency. The 2-minute-reference quality gate is not yet observed |
| P4 captions + render | ✅ closed 2026-11-05 — karaoke captions, bundled Tamil/emoji fonts, six templates, deterministic ffmpeg renderer, 1080p/2K/4K at 30/60 fps; 61-second playback gate approved |
| P5 V3 pipeline | 🟡 8/9 — all five steps through the real worker/queue, resume + retry + re-render routes. The 3-minute kill-and-resume gate is not yet observed |
| P6 API v1 | 🟡 3/8 — keys, rate limits, workspace scoping done; remaining `/v1` routes, credits/ledger, webhooks and libraries open |
| P7 MCP server | 🟡 — Streamable HTTP, tool registry and OAuth (DCR, PKCE, token rotation) implemented; the Inspector/client transcript artifact is not recorded |
| P8 web app | ✅ checklist complete |
| P9 templates | ✅ except Caption video — AI Video V2, Quiz, Fake Text (9 skins, `autoSplit`, per-character voices), Roblox Rant, CC0 background/SFX libraries; Caption video is blocked on a Python 3.14-compatible ASR wheel |
| P10 premium extras | ⬜ not started |
| P11 launch | 🟡 6/8 — compose stack verified end to end from a cold clone; limits enforced (max minutes/resolution, 402/403); structured logging + job health dashboard with exit-code alert; **public API/MCP docs site generated from contracts**; restore drill passes; notices and TTS licensing open |

## Licence

FacelessPro is released under the **MIT License** — the full text is in [LICENSE](./LICENSE).

What that means in practice:

- You may use, copy, modify, merge, publish, distribute, sublicense and sell it.
- The copyright notice and this licence text must be included in all copies or substantial
  parts of the software.
- There is no warranty.

Contributions are accepted under the same licence with a **DCO sign-off** (`git commit -s`),
so provenance stays auditable and every commit says who wrote it. The working agreement for
changes is [AGENTS.md](./AGENTS.md); third-party assets and model licences are tracked in
[docs/11-legal-and-compliance.md](./docs/11-legal-and-compliance.md).

> **Not a hosted-service launch.** The default narration engine (`edge-tts`) drives Microsoft's
> consumer Read Aloud endpoint, which is not a public API — see docs/11 §2. The source is open;
> a public deployment needs a licensed TTS engine first.
