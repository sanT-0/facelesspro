# AGENTS.md — working agreement

For any future session (human or agent) touching this repo.

## Read first, in this order

1. `plan.md` — what we are building and why
2. `docs/PROGRESS.md` — what is actually true right now
3. `docs/08-testing.md` — how work is accepted
4. the one spec doc for the area you are touching

Do not start coding before step 4.

## The loop (non-negotiable)

```
one task → contract + failing test → smallest real implementation
        → npm run gate (and pytest if media/render) → artifact check
        → tick docs/PROGRESS.md → next task
```

- **One task at a time.** Not three in parallel, not "while I'm here".
- A phase does not close with a red gate, a skipped test, or an unverified artifact.
- If you deviate from a spec, **edit the spec in the same change**. The docs are the contract.

## Code rules

- **`packages/core` is pure.** No I/O, no network, no `Date.now()`, no `process.env`, no deps.
  If a new behaviour needs time or randomness, inject it.
- **All shapes in `packages/contracts`.** If a request field is not in a zod schema, it does not
  exist. api, worker, web and mcp all import the same schema.
- **Ports, not vendors.** The pipeline calls `ImagePort`, never `cloudflareImage`. New provider =
  new adapter + one env entry.
- **Idempotency is a property of every step.** `(video_id, step)` is the key. Re-running must
  charge once and produce one artifact.
- **Ledger writes live in the same transaction as the state change.** No exceptions.
- **No copy from vsub.** Not code, not copy, not assets. See
  `docs/11-legal-and-compliance.md`.
- TypeScript strict, `noUncheckedIndexedAccess` on. No `any` in new code; `unknown` + a zod parse.
- Errors: typed results at boundaries, thrown exceptions internally. Every user-facing error has
  a `code` from the table in `docs/07-api-and-mcp.md`.
- Python: type hints everywhere, `ruff`-clean, no global state in `services/media`.

## Naming

| Thing | Convention |
|---|---|
| Product | FacelessPro |
| Package scope | `@facelesspro/*` |
| Python services | `facelesspro-media`, `facelesspro-render` |
| API keys | `vp_` + 40 hex |
| Step ids | `create-scenes`, `create-vocal`, `create-images`, `create-captions`, `render` |
| Video status | `processing` → `rendering` → `completed` \| `failed` |

Step ids and status values are a **public contract** (parity). Do not rename them casually.

## Tamil correctness is a hard requirement

Any change touching text, captions, fonts, or audio must keep these true:

- Tamil grapheme clusters are never split by a caption line break.
- The bundled Noto Sans Tamil is used, and the glyph golden-frame test stays green.
- `concat(scenes.text)` still reconstructs the script.
- Word timings remain `global = run.start + word.local`.

If a change breaks any of these, it is wrong even if the feature "works".

## Testing rules

- No network in unit tests. Live tests are `LIVE=1` and separate.
- Fakes for every port; **real ffmpeg** in render tests.
- Property tests for timing invariants.
- Golden digests are advisory; duration/loudness/resolution are hard failures.
- Never `test.skip` to get green.

## When you finish a task

1. `npm run gate` (+ `pytest` if applicable) — paste the result in your reply.
2. Tick `docs/PROGRESS.md` with today's date and one line about anything surprising.
3. If you changed a contract, update `01`/`07` in the same change.
4. State plainly what is **observed** vs **assumed**. Do not claim a feature works because the
   code compiles.

## Things that will get a change rejected

- Copying vsub assets/code/copy.
- A new paid dependency that is not optional.
- A model call inside a unit test.
- A step that is not idempotent.
- A ledger write outside the state-change transaction.
- Skipping the listening gate for TTS work.
- Marking a phase done with a red or skipped test.
