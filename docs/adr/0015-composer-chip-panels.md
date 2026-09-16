# The composer's chip carries a panel, and its contributor owns the panel's state

`ComposerContributions.chips` was a list of labels with icons. Issue #49 needs a chip that lists the host's projects and composes a new one; #50 needs a chip that lists models. A chip whose panel is a nested submodel, or a contribution that carries pre-built markup, would make the composer hold state that belongs to another feature.

## Decision

`ComposerChip` gains `isOpen` and a `panel` that is `ComposerChipMenu | ComposerChipForm`: options with labels, descriptions, and a selection mark, or a form with titled fields, a submit label, an error line, and whether submit is disabled. The panel is data, not markup.

The composer renders that data into its own Message universe and gains four pass-through Messages and four OutMessages. `Composer.Model` is untouched, so the open panel, the drafts, and the refusal all stay in the submodel that contributed the chip. Root routes each OutMessage to that submodel by chip id, and that routing table is the only place the mapping lives.

A chip without a panel is a label and keeps its old markup. A chip with an open panel renders a backdrop that closes it, so one panel is open at a time by geometry rather than by shared state.

## Considered options

- **A nested `Menu`/`Form` submodel inside the composer**: `h.submodel`'s `viewInputs` rejects functions and vnodes carrying handlers across the boundary, and the panel's state would live in the composer while its content lived in the contributing module.
- **Pre-built `Html` in the contribution**: the same boundary problem, and the markup would be built in root's Message universe to be rendered inside the composer's.
- **A string-encoded gesture** (`RequestedAction({ id: 'project:new' })`): the trigger click already has an outlet, but a panel's fields carry values, and encoding those as strings loses the types the owning submodel matches on.
- **The chip's state in `root.Model`**: one feature's draft split across two modules, and #50's picker would then share state it does not own.
- **A shared `openChip` field in `Composer.Model`**: the composer would own cross-feature state and every chip would have to register with it.

## Consequences

- Adding a chip with a panel is: contribute the chip, add one arm per OutMessage to root's routing table, and fold the resulting message into the owning submodel. The composer does not change.
- The panel's error line is the host's own refusal rendered where the write was attempted, so a refused write is visible instead of a silent no-op.
- A draft the host owes an answer for cannot be dismissed, replaced, or amended until that answer arrives, and the panel renders it that way by disabling its own cancel. One draft per surface can be in flight, so an answer can only reach the draft that asked for it: a refusal never lands on a form that replaced it, and a refusal never describes text the user has already changed.
- The chip names the project the user picked while the host still lists it, otherwise the host's first, the way the harness registry resolves `preferred()` for a thread that names no harness. Only a pick is marked in the menu, so the panel never claims a choice no fact backs.
- #51 deletes the composer's remaining invented chips. They are labels, so the deletion touches no panel state.
