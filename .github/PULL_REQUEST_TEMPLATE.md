<!--
  Read this before filling it in. A PR that skips the checklist is sent back, not read.
  Keep the PR to ONE roadmap task or issue.
-->

## What and why

<!-- One paragraph. What changes, and what problem it solves. -->

Closes #

## Checklist

- [ ] **One task.** This PR does one thing; unrelated refactors are split out.
- [ ] **Test first, or N/A explained.** Behavioural code has a test that failed before the
      change and passes after it. For docs/config only, the reproducible factual or structural
      check is named below instead; no fake test was added for prose.
- [ ] **Gate pasted.** `npm run gate` output is quoted below (not "tests pass").
- [ ] **Python ran** (`python -m ruff check app tests`, `python -m pytest`) if this touches
      `services/media` or `services/render`; otherwise say "not applicable".
- [ ] **Artifact checked** if this changes output: I opened the PNG/MP4/audio, or quoted the
      numbers, and the result is described below.
- [ ] **Docs ticked.** `docs/PROGRESS.md` has a dated line. If behaviour changed, the spec doc
      (`docs/01`, `docs/04`, `docs/07`, …) was edited in this same PR.
- [ ] **Contract updated** in `packages/contracts` if a request/response shape moved.
- [ ] **No skipped tests.** Nothing was disabled to get green.
- [ ] **DCO.** Commits carry `Signed-off-by` (`git commit -s`).
- [ ] **No vsub** code, copy, assets or branding (docs/11 §1).
- [ ] **No new mandatory paid dependency**; anything new is optional and documented in
      `.env.example`.
- [ ] **Tamil rules hold** if text/captions/fonts/audio were touched: no grapheme split,
      bundled Noto Sans Tamil, `concat(scenes.text)` intact.

## Gate output

```
paste `npm run gate` result here
```

## Observed vs assumed

<!--
  Observed: what you actually ran and saw (artifact opened, ffprobe numbers, API response).
  Assumed: anything you could not run here (no provider key, no database, no GPU).
-->

**Observed:**

**Assumed:**

## Screenshots / artifacts

<!-- Drop the image or clip here when the change is visual. Delete otherwise. -->
