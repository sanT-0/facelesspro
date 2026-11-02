# 12 — Maintaining this repository

How a contribution is verified, and which repository settings make that verification mean
something. Written down so the answer to "can this PR land?" does not depend on my mood or my
memory.

Two halves:

- **Settings** (§1–§4) live in the GitHub UI, not in this repo. They are listed here so they can
  be applied once and re-checked, and so a second maintainer inherits the same rules.
- **Procedure** (§5–§6) is the review itself: what I run, what I read, and what I refuse.

---

## 1. Branch protection on `development`

`development` is the only integration branch. Nothing lands on it except by squash-merge of a
PR whose checks are green.

First set **Settings → General → Default branch → `development`**. This is functional, not
cosmetic: GitHub reads the licence, community-health files, issue forms, security policy and
Dependabot configuration from the default branch. It also makes a contributor's new PR target
the branch this project actually reviews. Keep `main` as the release branch, protected by its own
rule if releases continue to be promoted there.

Then open **Settings → Rules → Rulesets**. The active ruleset is named `development` and targets
`~DEFAULT_BRANCH`; confirm that target in *Target branches* and keep these values:

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | **on** | the review and the contract live in the PR, not in the commit |
| Required approvals | **0 for now → 1 later** | 0 while the only maintainer is also the only author, otherwise my own PRs deadlock. Raise to 1 the day a second maintainer exists, and enable *Dismiss stale approvals on new commits* in the same edit |
| Require review from Code Owners | **off for now** | with `.github/CODEOWNERS` pointing at the sole maintainer it is the same deadlock |
| Require status checks to pass | **on** | this is the gate |
| Required checks | **`gate (node 22)`**, **`python 3.12`** | exact check-run names from `.github/workflows/ci.yml`; a typo here silently requires nothing |
| Require branches to be up to date before merging | **on** | the gate proves a combination that was actually tested |
| Require conversation resolution | **on** | an open question in review must not survive a merge |
| Allowed merge methods | **squash only** | the ruleset and repository-wide merge settings must agree |
| Require linear history | off | squash-merging already gives one commit per task |
| Require signed commits | off | provenance here is the **DCO** (`git commit -s`), not GPG |
| Block force pushes | **on** | history on `development` must be append-only |
| Block deletions | **on** | |
| Allow bypass (admin) | **on during bootstrap, off once stable** | with 0 required approvals a broken setting could otherwise lock the repo owner out of their own branch |

> **Check names change if the workflow changes.** Renaming a job means re-editing the required
> checks list; a required check that no longer exists shows as "expected — waiting" forever and
> blocks every PR.

## 2. Merge policy

Settings → General → Pull requests:

- **Allow squash merging — on.** Default message: *Pull request title and description*, so the
  title becomes the commit subject and the observed-vs-assumed record is retained as the body
  (one commit per roadmap task is what `docs/PROGRESS.md` is written against).
- **Allow merge commits — off.** **Allow rebase merging — off.** Two ways to merge produces two
  histories to reason about.
- **Automatically delete head branches — on.** Keeps the branch list honest; a closed PR's branch
  is not a thing anyone needs back.
- **Always suggest updating pull request branches — on.**
- **Require contributors to sign off on web-based commits — on.** Browser edits must follow the
  same DCO rule as `git commit -s`.

## 3. Security features

| Setting | Where | Why it matters here |
|---|---|---|
| **Private vulnerability reporting** | Settings → Code security | `SECURITY.md` and the issue-form contact link point at `…/security/advisories/new`. **Those links 404 until this is enabled.** |
| **Dependabot alerts** | Settings → Code security | `.github/dependabot.yml` only controls update PRs; alerts are a separate toggle |
| **Dependabot security updates** | Settings → Code security | patches reachable CVEs without waiting for the weekly group |
| **Secret scanning** + **Push protection** | Settings → Code security | free on public repos; stops a `vp_…` or provider key at `git push` instead of after |
| **CodeQL / default code scanning** | Settings → Code security | do not add it to required checks until it has run green at least once |
| **Actions → Workflow permissions** | Settings → Actions → General | **Read repository contents** — the workflow already asks for `contents: read`; the default on a fresh repo is often write. Leave *Allow GitHub Actions to create and approve pull requests* off |
| **Require approval for first-time contributors** | Settings → Actions → General | keep the default on: no workflow runs on a stranger's first PR until a human clicks approve |

## 4. Labels and metadata

Labels the tracker and the docs refer to (Settings → Labels):

`bug`, `enhancement`, `documentation`, `dependencies`, `needs-triage`, plus the ones this project
actually uses:

| Label | Meaning |
|---|---|
| `good first issue` | scoped, needs no prior context, the contract is already written |
| `help wanted` | I will not get to it soon and would welcome a PR |
| `contract` | touches `packages/contracts` or a public API shape — needs a spec edit in the same PR |
| `pipeline` | touches a step, the worker or a port |
| `docs` | docs only, gate is still required |
| `needs-artifact` | cannot be accepted on green CI alone; the reviewer must see the PNG/MP4/audio |

Topics: `ai`, `video-generation`, `text-to-speech`, `tamil`, `ffmpeg`, `self-hosted`,
`typescript`, `hono`, `nextjs`, `mcp`.

Observed before the settings pass (2026-11-01): only GitHub's default labels exist; `dependencies`,
`needs-triage`, `contract`, `pipeline`, `docs` and `needs-artifact` are missing, and the topics list
is empty. After the pass, the API returns all eight project labels and all ten topics above.

## 5. Verifying an incoming PR

Order matters: cheap checks first, and nothing expensive before CI is green.

1. **Is it one task?** If the PR mixes a feature and an unrelated refactor, ask for a split
   before reading the diff. A PR that cannot be described in one sentence cannot be reviewed.
2. **Is it on the roadmap or agreed in an issue?** A surprise PR that changes direction is
   declined regardless of quality.
3. **CI.** Wait for `gate (node 22)` and `python 3.12`. Red CI means no review — this is not a
   formality, it is the whole acceptance mechanism.
4. **DCO.** `git log --format='%an <%ae>%n%(trailers:key=Signed-off-by)' origin/development..HEAD`
   — every commit needs a `Signed-off-by` matching its author. Missing sign-off is a `git commit
   --amend -s` away, so it is a request, not a rejection.
5. **Read the diff against the rules** in `AGENTS.md` and `CONTRIBUTING.md`. What I actually look
   for:
   - a test that failed before behavioural code changed, not just tests that pass after it; for
     docs/config-only work, a reproducible factual or structural check and an honest N/A instead;
   - `packages/core` still pure — no `Date.now()`, no `process.env`, no I/O, no deps;
   - shapes in `packages/contracts`, parsed with zod, not hand-typed `interface`s;
   - the step is idempotent on `(video_id, step)`; ledger writes inside the state-change
     transaction;
   - no `any`; `unknown` plus a parse;
   - errors carry a `code` from `docs/07`;
   - no vendor SDK where a port belongs;
   - **no third-party product's code, copy, assets or branding** (`docs/11` §1) — this one I
     check deliberately, file by file, because it is the one mistake that is expensive to undo.
6. **Tamil invariants** if text, captions, fonts or audio were touched: grapheme clusters not
   split at line breaks, bundled Noto Sans Tamil, `concat(scenes.text)` intact, word timing still
   `global = run.start + word.local`. A green gate does not prove the clip sounds right.
7. **Re-run the gate locally.** `npm run gate`, plus `python -m ruff check app tests` and
   `python -m pytest` in `services/media` when that tree moved. I want to see the number of tests
   *increase* by the tests the PR claims to add.
8. **Re-verify the artifact** for anything labelled `needs-artifact`: open the PNG/MP4, check
   with `ffprobe` that duration, loudness and resolution match the claim. "It renders on the
   contributor's machine" is not evidence for mine.
9. **Read the observed-vs-assumed section.** Anything the contributor could not run (no provider
   key, no database) is *assumed*, and I say so in the review instead of inheriting a claim.
10. **Docs ticked.** A dated `docs/PROGRESS.md` line, and if behaviour changed, the spec doc
    edited in the same PR. Missing docs is a change request, not a follow-up.

Expect one round of `file:line` comments. If a PR goes quiet for 30 days after a review round,
close it and say it can be reopened.

## 6. Merging

- **Squash-merge only**, and press it myself. The PR title becomes the commit subject — rewrite
  it if it is vague. The PR body becomes the squash commit message; keep the observable-facts
  part.
- **Wait for post-merge CI.** A green PR run does not prove the squash commit is green: the merge
  base moved. `https://api.github.com/repos/sanT-0/facelesspro/actions/runs?branch=development&per_page=1`
  or the Actions tab. If `development` goes red, fixing it is the next task, ahead of any feature.
- Shadow the merge locally if the contributor's claim matters:
  `git fetch && git checkout -b review/pr-<n> origin/development && git cherry-pick -m 1 …`, or
  simply `npm run gate` in a worktree.

## 7. What cannot be done from a file

Everything in §1–§4 is a repository setting. Editing a workflow, a template or this document does
**not** turn on branch protection, required checks, secret scanning or private vulnerability
reporting. Until those toggles are set in the browser, a PR can in principle be merged red — the
settings are the enforcement, the docs are only the intent.

**Observed (2026-11-01):** the initial audit found `main` as the default branch, `development`
unprotected, private vulnerability reporting off, and a 28% community profile. The settings pass
then changed the default to `development`; GitHub detects the repository licence (AGPL-3.0
at the time of that audit, MIT since the 2026-11-02 relicensing) and reports 100% community
health. The active ruleset requires `gate (node 22)` and `python 3.12` in strict up-to-date mode,
resolved conversations and squash-only PRs, while deliberately requiring zero approvals and no
code-owner review until a second maintainer exists. Private vulnerability reporting, web-commit
DCO sign-off, all project labels and all topics are enabled. PR #5 produced green PR CI (run #33),
green CodeQL for Actions/JavaScript/Python and no new code-scanning alert. It was squash-merged as
one-parent commit `9ed31fd`, the head branch was automatically deleted, and post-merge CI run #48
plus CodeQL run #4 both completed green.

**Maintainer-observed in the authenticated UI, not independently readable through the public
API:** Dependabot alerts/security updates, secret scanning/push protection, read-only Actions
workflow permissions and first-time-contributor workflow approval are enabled.
