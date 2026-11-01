# Contributing to FacelessPro

Thanks for wanting to help. This project is built **one roadmap task at a time**, with a test
written before the code and a gate that must be green before anything lands. Read this page once;
it is short, and it is the difference between a PR that merges in a day and one that stalls.

- Licence: **AGPL-3.0** — by contributing you agree your work is released under it.
- Sign-off: every commit needs a **DCO** line (`git commit -s`).
- Target branch: **`development`**. PRs are **squash-merged by a maintainer**.
- Non-negotiable: **no vsub code, copy, assets or branding.** See
  [docs/11 §1](./docs/11-legal-and-compliance.md).

---

## 1. Before you write code

Read, in this order:

1. [`plan.md`](./plan.md) — what this is and why.
2. [`docs/PROGRESS.md`](./docs/PROGRESS.md) — what is actually true today.
3. [`docs/08-testing.md`](./docs/08-testing.md) — how work is accepted.
4. **The one spec doc for the area you are touching** (`docs/01` for API shape, `docs/04` for the
   pipeline, `docs/05` for Tamil/TTS). Do not start before this.

Then pick work:

- An unchecked item in [`docs/09-roadmap.md`](./docs/09-roadmap.md), or
- an issue labelled `good first issue`, or
- a bug you found — **open an issue first** if the fix is not obvious.

If your idea is not on the roadmap, open an issue and get a yes before writing it. A surprise PR
that changes direction cannot be merged, however good the code is.

## 2. Set up

Requirements: **Node ≥ 22**, **Python 3.12** for `services/media` (CI uses 3.12; 3.13/3.14 may
work locally but is not what the gate proves), **ffmpeg** on `PATH`, and Docker for Postgres.

```bash
cp .env.example .env
docker compose up -d postgres
npm ci                 # not `npm install`: the lockfile is part of the contract
npm run db:migrate
npm run gate           # this must be green before you start

cd services/media
python -m venv .venv
# Windows: .venv\Scripts\activate   |   POSIX: source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python -m ruff check app tests
python -m pytest
```

`npm run gate` is `typecheck && lint && test`. It is hermetic: no database, no network, no
provider keys. `npm run test:db` needs the Postgres container and is **not** part of the gate.

## 3. The loop

```
one task → contract + failing test → smallest real implementation
        → npm run gate (and pytest if media/render) → artifact check
        → tick docs/PROGRESS.md → next task
```

- **One task per PR.** Not three, not "while I'm here". Split unrelated refactors out.
- A phase does not close with a red gate, a skipped test, or an unverified artifact.
- If you deviate from a spec, **edit the spec in the same PR**. The docs are the contract.

### The rules that get a change rejected

- `packages/core` is pure: no I/O, no `Date.now()`, no `process.env`, no dependencies. Inject
  time and randomness.
- All shapes live in `packages/contracts`. If a field is not in a zod schema, it does not exist.
- The pipeline calls ports (`ImagePort`, `PlannerPort`), never a vendor SDK. A new provider is an
  adapter plus one env entry.
- Every step is idempotent on `(video_id, step)`. Re-running charges once and produces one artifact.
- Ledger writes happen in the same transaction as the state change.
- No `any` in new code — `unknown` plus a zod parse. TypeScript strict is on, including
  `noUncheckedIndexedAccess`.
- Every user-facing error carries a `code` from [docs/07](./docs/07-api-and-mcp.md).
- Python: type hints, `ruff`-clean, no global state in `services/media`.
- No copying vsub. Behaviour yes, expression no.

### Tamil correctness is a hard requirement

Any change touching text, captions, fonts or audio must keep these true:

- Tamil grapheme clusters are never split by a caption line break.
- The bundled Noto Sans Tamil is used; the glyph golden-frame test stays green.
- `concat(scenes.text)` still reconstructs the script.
- Word timings stay `global = run.start + word.local`.

If a change breaks one of these, it is wrong even if the feature "works".

### Tests

- No network in unit tests. Live tests are opt-in (`LIVE=1`) and separate.
- Fakes for every port; **real ffmpeg** in render tests.
- Never `test.skip` to get green.
- Golden digests are advisory; duration, loudness and resolution are hard failures.

## 4. Commits and the PR

```bash
git checkout -b fix/caption-grapheme-split
# ... work ...
npm run gate
git add -A
git commit -s -m "Keep Tamil grapheme clusters intact at caption line breaks"
```

- `-s` adds `Signed-off-by: Name <email>` — the DCO. PRs without it cannot be merged.
- One logical change per commit; the PR is squashed on merge, so the PR title becomes the
  commit subject on `development`. Write it like `Add …`, `Fix …`, `Keep …`.
- Fill in the PR template. Paste the **real gate output**, not "tests pass".
- Say plainly what you **observed** (ran it, opened the artifact, saw the numbers) and what you
  **assumed**. Do not claim a feature works because it compiles.

## 5. What review looks like

1. CI runs first: `gate (node 22)` and `python 3.12`. Red CI means no review.
2. One maintainer reads the diff against the rules above. Expect one round of changes, with
   `file:line` comments.
3. For render/TTS/image changes, the reviewer re-runs the claimed artifact locally.
4. Green + approved + up to date with `development` → **squash merge by the maintainer**.

We aim to respond within about a week. If a PR goes quiet after a review round, it may be closed
after 30 days — reopen any time.

## 6. Security

Do **not** open a public issue for a vulnerability. Use GitHub's **Report a vulnerability**
(Security → Advisories), as described in [`SECURITY.md`](./SECURITY.md).

## 7. Licence and provenance

Contributions are licensed under AGPL-3.0. There is no CLA; the DCO is the paper trail. Do not
paste code from another project unless its licence is compatible and you say so in the PR.
