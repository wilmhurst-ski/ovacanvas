# OvaCanvas — What May Be Committed and Pushed

This repository is public. Every push is permanent, attributable, and read by
people who were not in the conversation that produced it. These rules are
mandatory for any agent working here. They are not style preferences.

If a rule blocks you, **stop and ask**. Do not work around it.

---

## 1. The one-line test

> **Push only what a future reader of this repository needs in order to run,
> understand, or change the software.**

Everything else — however much work it took, however good it is — belongs
somewhere that is not this repository.

---

## 2. What belongs in this repository

- Production source under `packages/*/src/`.
- Tests, beside the code they test, following the existing convention
  (`geometry/geometry.test.ts`, not `geometry/testing/geometry.test.ts`).
- Small fixtures a test genuinely needs, in the same place as that test.
- Package manifests, lockfile, build and lint configuration.
- `README`, `LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`,
  `CHANGELOG`, and `.github/` community files.
- Architecture Decision Records in `docs/adr/`, one per decision, recording what
  was decided and why — **not** how the work went.

## 3. What must never be committed here

Not "should avoid". Never.

- **Mission briefs, handoffs, task plans, implementation plans, execution
  orders, checklists, status reports, progress summaries, direction reviews,
  session notes, or agent instructions.** These are process artefacts about
  work; they are not the software. They live outside this repository.
- **Evidence and verification output**: test reports, run logs, timing numbers,
  screenshots, videos, traces, coverage output, browser artefacts, golden
  images, `test-results/`, `playwright-report/`.
- **Anything describing what an agent did**: "final green run", "correction
  pass", "closure report", "witness", "proof" documents.
- Scratch, spike, probe or experimental code; `*.bak`, `*.old`, `*.copy`,
  `*-new`, `*-v2`, commented-out replaced code.
- Build output, `dist/`, `lib/`, `node_modules/`, caches, `.env`, archives
  (`*.zip`), local paths, credentials of any kind.
- Files whose only purpose is to tell the next agent what to do.

**Naming test files or documents `witness`, `evidence` or `proof` does not make
them source.** If a file exists to demonstrate that work happened, it does not
belong here. A test that guards behaviour belongs here; a document reporting
that the test passed does not.

## 4. Before every commit

Run these and read the output:

```bash
git status --short          # nothing unexpected, nothing untracked you meant to add
git diff --stat             # is every file here something section 2 permits?
git diff --check            # no whitespace damage
```

Then, for what you touched:

```bash
npx tsc -p packages/core --noEmit          # and every other affected target
npx lerna run build
npm run eslint
npm run prettier
npm run core:test / npm run 2d:test        # the suites your change affects
```

**A type error is a failure even when the tests pass.** Vitest compiles with
esbuild and does not typecheck, so a broken type can sit behind a green suite.
Typecheck every package you modified — including ones you only modified
incidentally.

Never commit with `--no-verify` unless the hook itself is broken, and say so if
you do.

## 5. One commit, one concern

- A commit contains one coherent change. A capability and an unrelated fix are
  two commits.
- Conventional Commits, and the subject says what changed, not what you were
  asked to do.
- The body explains **why**, and names anything a reviewer would otherwise have
  to guess: a rejected alternative, a deliberate limitation, a known gap.
- Never claim a verification you did not run. If a suite was not run, do not
  imply it was.
- Do not invent authorship. No fictional teams, no roles nobody holds, no
  co-authors who did not contribute. The commit author is whoever the repo's git
  identity says.

## 6. Do not touch another agent's work

- Before starting, run `git status`. If files you intend to change already carry
  uncommitted work, **stop and report the exact paths**. Do not absorb, merge or
  overwrite them.
- Never commit another agent's uncommitted changes alongside yours.
- Never `git add -A` or `git commit -a` without reading what that stages.

## 7. Pushing

- Push to `main` only as a **fast-forward**. Verify first:
  ```bash
  git fetch origin && git merge-base --is-ancestor origin/main HEAD
  ```
- **Never** `--force`, `--force-with-lease`, `--mirror`, rebase published
  history, or amend a pushed commit — unless the repository owner explicitly
  asks for that specific action in that specific case.
- If the remote has diverged: stop and report. Do not merge unrelated histories,
  do not reset, do not force.
- Do not push tags. Do not create releases.
- Push only the branch you were asked to push.

## 8. Dependencies

A dependency is a permanent commitment made on someone else's behalf.

- **No new dependency without the owner's explicit approval for that specific
  package.** Not implied by a task mentioning a technology, not justified by
  convenience, not "already in the lockfile so it's fine".
- Pin the exact version. No ranges.
- Record the decision in `docs/adr/`: what it does, what was considered instead,
  what it costs, and what it would take to remove.
- A capability you can implement in bounded code does not need a library. A
  capability you cannot implement correctly needs a conversation, not a silent
  install.

## 9. Deleting

- Do not delete files to make a description true. If you were told something is
  junk and you cannot find it, **say you cannot find it** and show what you
  searched. Deleting real work to match an inaccurate premise is worse than
  leaving noise in place.
- Before removing anything, confirm nothing imports it (`git grep`), and say
  what you checked.

## 10. When something is unclear

Say `UNKNOWN — NOT ENOUGH EVIDENCE` and stop. Do not fill a gap with a plausible
guess, and do not implement past the point where you stopped understanding.
Reporting a blocked boundary is a successful outcome; a confident wrong commit
is not.
