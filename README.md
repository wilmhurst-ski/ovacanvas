# OvaCanvas

OvaCanvas is an interactive visual runtime for building deterministic,
computational and continuously evolving explanations in the browser.

It is a fork of [Motion Canvas][motion-canvas] that has been extended around
semantic identity, runtime authority, learner interaction, presentation
generations and reusable computational capabilities.

## Why this exists

Most animation tools are built to play back something that was decided in
advance. You write the animation, it runs, and the viewer watches it. That is
the right design for a video, and the wrong one for an explanation that has to
respond to the person receiving it.

OvaCanvas is built for the second case: one visual world that stays alive while
a learner pokes at it, changes their mind, asks a follow-up, and gets shown
something new — without the picture and the truth drifting apart. The hard part
turns out not to be drawing. It is knowing, at every moment, which of the three
things on screen is authoritative: the state the system has actually accepted,
the value a learner is provisionally holding while they drag something, and the
presentation currently being rendered. Conflating those is how interactive
explanations quietly start lying.

So the runtime keeps them separate and makes the boundaries explicit. Exploring
writes nothing. Committing goes through one narrow, generation-scoped path. A
replacement presentation is built offstage and refused if the world moved on
while it was being built. A retiring presentation loses its authority the
instant a new one takes over, even while both are still visible. None of this is
about graphics; it is about not being wrong in front of someone who is trying to
learn.

## What OvaCanvas provides

The scene system is inherited from Motion Canvas: TypeScript, generator-driven
animation, Canvas2D rendering, and a Vite-based development pipeline.

On top of that, OvaCanvas adds a runtime whose organising idea is that
**rendered objects are not the authority on what is true**:

- a deterministic runtime authority that owns accepted state, hands out
  generation-scoped write capabilities, and refuses stale writes;
- presentation generations that are prepared offstage, activated at a single
  atomic boundary, and retired terminally;
- semantic-target picking and pointer interaction over the scene graph;
- temporary learner exploration held as an overlay, separate from accepted
  state, so exploring changes nothing until it is deliberately committed;
- semantic continuity across generations — the same semantic id resolving to a
  different node object in a different presentation;
- runtime-constructed presentations, assembled while the application is running
  rather than imported from a build-time project module;
- revision-checked activation, so a presentation prepared against state the
  learner has since changed is refused rather than shown;
- bounded overlap between an outgoing and an incoming presentation;
- zero-idle scheduling: when nothing requires presentation work, the runtime
  requests no animation frames at all.

Alongside these are several self-contained computational capabilities used to
derive what a scene displays: relational graph layout, planar computational
geometry and polygon algebra, 3D projection with depth ordering, and
deterministic fixed-step numerical integration for dynamical state.

## Design philosophy

OvaCanvas owns visual realization and runtime behaviour. It does not define the
semantic truth of an explanation.

The architecture is intended to let a higher-level system drive one persistent
interactive visual world without treating renderer objects as semantic
authority. That is why accepted state, the provisional value a learner is
holding, and the thing currently on screen are three separate concerns with
three separate owners — and why reaching quiescence never means silently
accepting what a learner had not accepted.

## Project status

The OvaCanvas pre-contract runtime foundation is complete: the runtime,
interaction, transition and capability work described above is implemented and
covered by unit and real-browser regressions.

The public API is still evolving. Several runtime surfaces are deliberately
documented as internal with shapes that are not frozen, and are reached through
a separate internal entry point rather than the package root.

The compiler contract that will eventually drive OvaCanvas from a higher-level
system is **not** part of this repository state. Nothing here should be read as
that protocol.

This project has not been proven in production use.

## Development

The project is one monorepo. After cloning, install and build everything:

```bash
npm install
npx lerna run build
```

| Package       | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `core`        | Runtime authority, playback, signals, capabilities.        |
| `2d`          | The 2D scene system, components and interaction.           |
| `player`      | A custom element for displaying scenes in a browser.       |
| `ui`          | The inherited editor interface.                            |
| `vite-plugin` | The Vite plugin used for developing and bundling projects. |
| `template`    | A template project used during development.                |
| `internal`    | Build helpers used by the other packages.                  |
| `e2e`         | End-to-end and browser proofs.                             |

Unit suites (Vitest):

```bash
npm run core:test
npm run 2d:test
```

The browser proofs launch a real Vite dev server and a real browser, and are run
individually:

```bash
npm run test:composition -w packages/e2e
npm run test:transition -w packages/e2e
npm run test:runtime-built -w packages/e2e
```

Linting and formatting:

```bash
npm run eslint
npm run prettier
```

Commits follow the [Conventional Commits][commits] convention; git hooks run
ESLint and Prettier on staged files.

## Upstream and attribution

OvaCanvas began as a fork of **Motion Canvas**, created by aarthificial and its
contributors:

<https://github.com/motion-canvas/motion-canvas>

Motion Canvas is MIT licensed. A substantial part of this repository is upstream
Motion Canvas code, and OvaCanvas preserves the applicable upstream copyright
and license notices. The upstream copyright notice remains in
[LICENSE](./LICENSE) alongside OvaCanvas's own.

The changelogs in this repository and in each package predate the fork and are
retained as upstream release history.

## Contributing

See the [Contribution Guide](./CONTRIBUTING.md) and the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

MIT — see [LICENSE](./LICENSE).

[motion-canvas]: https://github.com/motion-canvas/motion-canvas
[commits]: https://www.conventionalcommits.org/
