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

---

# How to actually get work done here

The rules above say what may be committed. This part says how to work so that
what you commit is the right thing.

## 11. Additions must fall in place

> **Thinking beyond the brief is welcome. Whatever you add must still fall in
> place with the instructions you were given.**

This is the governing rule of this section, and it is not a restriction on
initiative. A better idea is valuable. An idea that quietly replaces the task
you were given is not, however good it is in isolation, because nobody asked for
it and nobody is expecting it.

Drift here has rarely looked like wild invention. It has looked like
reasonable-seeming additions that contradicted something already decided.

**Trace every addition to the brief.** Before adding a file, type, option,
abstraction or dependency, name the sentence in the task that requires it. If
you cannot point at one, you are not extending the task, you are substituting
your own. Put that trace in the commit body: a reviewer should be able to see
why each piece exists.

**If the brief and the repository disagree, stop and ask.** Do not resolve the
conflict silently in either direction. Silently choosing is how a task comes
back finished and wrong.

**Answer the question you were asked, then stop.** Delivering the brief plus
three unrequested features is not over-delivery; it is three things nobody
reviewed. Note the ideas in your report instead, and let the owner choose.

## 12. Read before you write

**Read the whole file you are about to change**, not the region around your
edit. Most of the damage in this repository has come from edits that were
locally correct and globally wrong.

Two real examples, both from a single commit:

- A field was inserted between a TSDoc block and the member that block
  described, so the documentation silently began describing the wrong thing.
  Reading twenty lines instead of five would have prevented it.
- A field was added without importing its type. The suites stayed green because
  Vitest compiles with esbuild and does not typecheck, so a broken package sat
  behind 348 passing tests.

**Search before you name anything.** `git grep` the identifier you intend to
introduce. If it already exists, you have found either the thing you should be
using or a collision you must resolve — not a reason to pick a different name.

## 13. Reconcile; do not accumulate

When your work overlaps something that already exists, the task is not complete
until there is **one** of each concept.

Leaving the old thing beside the new one is unfinished work, not extra work. Two
types with the same name, two implementations of one behaviour, or a superseded
module still exported — each of those forces every future reader to work out
which one is real.

If what you built supersedes something, **remove the old thing in the same
change** and say so in the commit. If it does not supersede it, do not duplicate
it. Renaming your version to dodge a name clash is not a resolution; it is the
collision plus a second problem.

This repository has already needed a −3,209-line cleanup for exactly this: a new
kernel was added, the old one was left in place, and the barrel re-exported a
hand-curated subset of it under a "legacy" comment to keep the two from
clashing.

## 14. Assume every constraint is load-bearing

A required field, a refusal, a narrow type, a `throw`, a validation — treat each
as deliberate until you have read the reason.

Before relaxing one, find the comment or the test that explains it. If neither
exists, ask. **Do not widen a constraint to make your own call site compile.**

A real case: a required `crossesAntimeridian` flag was redefined as optional,
which looked like a harmless ergonomic improvement. It was not. `west > east`
legitimately describes an interval spanning the seam, so the flag existed
precisely because inferring it is how a map shows the entire world when one
ocean was requested. The exported type then said optional while the validator
still refused it — a mismatch a consumer would only meet at runtime.

## 15. Follow the pattern that is already here

Consistency is worth more than your preference. Before inventing a shape, find
the nearest existing equivalent and match it: file layout, test placement,
naming, error style, documentation depth.

- Tests sit **beside** the code they test, as `module/module.test.ts`. Not in a
  `testing/` subdirectory.
- Errors use a closed code union plus one error class, as the existing modules
  do — not ad-hoc `throw new Error(string)`.
- Public types do not use `any`. A trusted boundary typed `any` is not a
  boundary.

If you believe the existing pattern is wrong, say so in your report and leave it
alone. Do not fix it as a side effect of unrelated work.

## 16. Verify, and believe the tools over your own reasoning

Your confidence is not evidence. Run the check.

- **A green test suite does not mean the code compiles.** Typecheck every
  package you touched.
- Run the suite that covers what you changed, and read the output rather than
  the exit code.
- Never bypass the pre-commit hook. If files land unformatted, the hook was
  skipped — which is visible to everyone afterwards.
- When you write a test, make sure it can fail: break the behaviour on purpose,
  confirm the test catches it, then restore. A test that passes against broken
  code is worse than no test, because it will be trusted.

## 17. Report honestly

- State what you ran and what it said. Never imply a verification you did not
  perform.
- If something is incomplete, blocked or uncertain, say which part and why. A
  named gap is useful; a confident summary that hides one is not.
- If you could not find something you were told to find, say that, and show what
  you searched. Do not make the description true by changing the repository.

## 18. Before you say you are done

Answer these, honestly:

1. Can I point at the part of the brief that asked for **each** thing I added?
2. Did I read every file I changed, in full?
3. Is there now exactly one of every concept I touched?
4. Did I relax any constraint, and do I know why it existed?
5. Does every package I touched typecheck, build, lint and pass its tests?
6. Does `git status` show only files I meant to change, and none of anyone
   else's work?
7. Have I invented any name, number, approval or date I cannot point at?
8. Is anything in my report a claim rather than something I observed?

Any "no" is work remaining, not a detail to mention in passing.
