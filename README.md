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

## Quick start (target state, P5+)

```bash
cp .env.example .env

docker compose up -d postgres      # database + job queue
npm install
npm run db:migrate

# python media service (TTS / ASR / art)
cd services/media && python -m venv .venv && .venv/Scripts/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --port 8000

# api + worker
npm run dev:api
npm run dev:worker
npm run ping              # smoke test: the worker completes a real job (exit 0)
```

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
apps/api            Hono HTTP API (v1 + MCP)
apps/worker         job runner (pg-boss consumers)
apps/web            Next.js studio + marketing
packages/core       pure TS: segmentation, scene math, captions, pricing, timelines
packages/contracts  zod schemas shared by api, worker, web, mcp
packages/art        renderer + fonts (Noto Sans + Noto Sans Tamil)
services/media      FastAPI: TTS, ASR, art-style extraction, image generation
services/render     ffmpeg composition (imported by worker as a CLI/py module)
docs                everything in the table above
```

## Status

| Phase | State |
|---|---|
| Docs & plan | ✅ done |
| P0 foundation | ✅ closed — `@facelesspro/*` workspaces, contracts, pure core, boundary lint, CI (Node 22 + Python 3.12) |
| P1 Tamil/English TTS | ✅ closed 2026-10-28 — all 35 gate clips approved by ear; five voices (`valluvar` male default, `pallavi` female default, `seraphina`, `vivienne`, `thalita`) |
| P2 scene planner | ✅ checklist complete — splitter, duration estimate, scene packing, provider planner chain + heuristic floor, `POST /v1/videos/plan` |
| P3 art style + images | 🟡 in progress — style build + previews, four image adapters, ordered chain, palette correction and cross-scene consistency, catalog/export endpoints. Gate (2-minute reference → six consistent scenes) not yet observed |
| P4 captions + render | ⬜ next — caption cue builder, ASS writer, renderer |

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
