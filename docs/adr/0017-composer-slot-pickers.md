# The composer is a box with slots, and every picker is its own submodel

`ComposerContributions` was static text the composer rendered: actions, chips,
menus, and forms as data, with the state living in `Projects` and `ModelPicker`
and root routing five messages by chip id. Adding a picker meant touching the
composer's vocabulary, the contributor's builder, and the routing table — three
modules for one control — and the composer owned markup (backdrops, forms,
pending guards) for state it never held.

## Decision

The composer shrinks to a draft, a submit, and four slots: `toLeading`,
`toTrailing` (optional, reserved for voice input), `toChipsLeft`, and
`toChipsRight`. Slots are callbacks the parent builds with its own `h`, the
way `Shell` does, so `composer.ts` imports zero picker modules. Its `Message`
is `ChangedDraft` and `ClickedSubmit`; its `OutMessage` is `Submitted { text }`
only. On submit the thread's creation reads the picker submodels root already
holds — nothing is copied into the composer.

Each picker is a full submodel mounted by root: `ModelPicker` (trigger plus
catalogue popover in `leading`, health banner above the composer),
`ProjectPicker` (chip, menu, and create form in `chipsLeft`, reading the host
list through `viewInputs`), and `WorktreePicker`, `BranchPicker`, and
`AccessPicker` facades with static rows until a host surface backs them. Each
owns its open state, its panel geometry (shared through the presentational
`picker-panel.ts`, which holds no state), and its drafts. `Projects` keeps the
host answer and the settings edit draft; the picker's selection and create
draft move next to the UI they drive. Host answers that move the picker
(`ProjectCreated`, `HostUnreachable`) arrive through `GotProjects` and are
folded into both submodels with `Update.combine`; the create refusal goes
straight to the picker, where its error renders.

## Considered options

- **A nested `Menu`/`Form` submodel inside the composer** (ADR-0015's rejected
  option): kept rejected. The panel's state would live in the composer while
  its content lived in the contributing module, and `viewInputs` rejects
  handler-carrying vnodes across the boundary.
- **`@foldcn/popover` + `@foldcn/menu` primitives**: the `@foldkit/ui`
  `Popover`/`Menu` submodels exist upstream, but installing the foldcn wrappers
  is a second change with its own migration. The pickers share one
  presentational helper instead; swapping it for the registry components later
  touches one module.
- **One generic facade factory for worktree/branch/access**: three tiny modules
  instead, so each grows its own RPC wiring independently when a backend lands.
- **The mic action as a trailing facade**: it was a dead button with no
  behavior. Dropped; the optional `toTrailing` slot reserves its place.

## Consequences

- Adding a picker is: a submodel, one `h.submodel` line in root's slots, and
  arms for its `OutMessage`. The composer does not change.
- `ComposerChip`, `ComposerChipMenu/Form`, `ComposerContributions`,
  `emptyContributions`, `mergeContributions`, and the chip-id routing table
  are gone. `data-composer-chip/*` and `data-composer-action/*` hooks become
  per-picker namespaces (`data-project-picker-*`, `data-model-picker-*`, …).
- The panel-routing unit tests are deleted; the create flow is covered by the
  picker's scene tests and the host-backed seam and browser suites, which walk
  the new hooks.
- The harness catalogue popover carries the harness fact row, so the choice
  names its harness; the full diagnosis stays in the banner above the
  composer, where it renders without opening anything.
