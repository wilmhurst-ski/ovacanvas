# Contributing to OvaCanvas

OvaCanvas is a small project and this is a short guide. If something here is
unclear or wrong, an issue pointing that out is a welcome contribution.

## Code of Conduct

Before contributing, please read our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting a bug

Search [the issue tracker][issues] first — the problem may already be known and
a workaround may already be described.

If it is new, [open an issue][new-issue] and include enough for someone to
reproduce it: what you did, what you expected, what happened, and any console
errors.

## Proposing a change

If you intend to change public API, make non-trivial changes to the runtime, or
add a new capability, please [open an issue][new-issue] first so the idea can be
discussed before you spend real effort on it.

Bug fixes and typo fixes do not need an issue — send a pull request with a clear
description.

Two things worth knowing before proposing runtime changes:

- Several runtime surfaces are deliberately **not frozen** and are documented as
  internal. They live behind `@ovacanvas/core/lib/internal` rather than the
  package root. That is intentional; please do not promote them to public API as
  part of an unrelated change.
- The architecture keeps accepted state, provisional learner state, and the
  rendered presentation as separate concerns with separate owners. Changes that
  blur those boundaries need a good reason.

## Making a pull request

1. Fork `wilmhurst-ski/ovacanvas`.
2. Create a branch for your change:
   ```shell
   git checkout -b my-fix-branch main
   ```
3. Make the change, and keep it focused. One concern per pull request.
4. Commit using a descriptive message following [Conventional
   Commits][commit-format]:
   ```shell
   git commit --all
   ```
   Git hooks run Prettier and ESLint on staged files. If hooks do not work in
   your environment, run `npm run prettier:fix` and `npm run eslint:fix`
   yourself.
5. Push and open a pull request against [`main`][main].

## Verifying your change

Run what your change touches. At minimum:

```shell
npx lerna run build
npm run eslint
npm run prettier
```

If you changed `core` or `2d`, run the relevant unit suite:

```shell
npm run core:test
npm run 2d:test
```

If you changed the runtime, interaction or transition behaviour, run the browser
proofs that cover it, for example:

```shell
npm run test:composition -w packages/e2e
```

These launch a real Vite dev server and a real browser, so they are slower than
the unit suites. Run the ones that are relevant rather than all of them.

## Using generative AI

Using generative AI to help write code or documentation is fine, but use it to
enhance your work rather than replace it. Pull requests that are an unreviewed
copy of a model's output will be rejected — if you would not be able to explain
and defend the change, please do not open it.

## Upstream

OvaCanvas is a fork of [Motion Canvas][motion-canvas]. If you have found a bug
in inherited Motion Canvas behaviour that is not specific to OvaCanvas, it may
be worth reporting upstream as well.

[issues]: https://github.com/wilmhurst-ski/ovacanvas/issues
[new-issue]: https://github.com/wilmhurst-ski/ovacanvas/issues/new/choose
[main]: https://github.com/wilmhurst-ski/ovacanvas/tree/main
[commit-format]: https://www.conventionalcommits.org/
[motion-canvas]: https://github.com/motion-canvas/motion-canvas
