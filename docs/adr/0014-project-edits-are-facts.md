# A project edit is a fact carrying the whole project

`project/created` was the only project fact, and `foldProjects` read the first one per id: a project's name and cwd were write-once. Issue #49 adds a rename and a cwd edit, and `UpdateProject` on `ProjectRpc`. Settings → Projects has to render the host's current project, and a thread's next turn has to run in the project's edited directory without anything rewriting history.

## Decision

`SessionEvent` gains `project/updated { project, name, cwd }`, a host-lane fact following `thread/configured`'s precedent: one fact per change, and the latest fact on the path is the whole answer. Both members are required. An update carrying only the changed member would make every reader replay two facts and merge them, and a reader that missed one would render a project that never existed.

`foldProjects` applies creates and then updates for the same id. An update for an id the log never created is dropped rather than manufacturing a project out of a fact about one. `foldProject` and `foldThreadCwd` read through `foldProjects`, so a thread's directory follows the latest update. The inference loop resolves `request.cwd` from the log on every turn, so an edit applies to the next turn and rewrites no lane.

`UpdateProject` refuses a relative cwd with the existing `RelativeCwd` and an id the log does not name with `UnknownProject` (`Schema.Union([RelativeCwd, UnknownProject])`). It writes the fact only after both checks pass and answers with the updated project.

## Considered options

- **Optional members on `project/updated`**, mirroring `thread/configured`: cheaper to write, but then "the latest fact" is not a complete project. `thread/configured` can afford an absent member because absent means "the harness's own default", and a project has no equivalent to defer to.
- **One fact per field** (`project/renamed`, `project/moved`): more tags, and `foldProjects` would merge per field for the same replay cost and no gain.
- **A mutable project store**: violates ADR-0003. A project would become the first piece of runtime state that is not a projection of the log.
- **`foldProjects` treating an update as a create**: the list could then disagree with the log about how a project came to exist, since nothing would have created it.
- **Rewriting the thread's cwd into its own lane on edit**: history would stop being a record of what happened, and a thread's directory would stop being derivable from its project.

## Consequences

- `SessionEvent` is closed, so every `Match.tagsExhaustive` over it gained a `project/updated` case: the kernel's three folds and `session-tree.ts`'s lane assignment, the inference plugin's history and work folds, and the four test helpers that enumerate the union. It is a host-lane fact, so a project edit never appears on a thread's lane.
- `foldProjects` is the only place either project fact is interpreted; `foldProject` and `foldThreadCwd` read through it.
- `ProjectClientContract.update` fails `RelativeCwd | UnknownProject | HostUnreachable` and leaves the host's own tags alone (ADR-0013).
- A project's cwd edit is not retroactive to threads that already ran; it applies to the next turn of every thread that points at the project.
- Deleting a project stays out of scope. Threads reference projects, and what happens to a thread whose project is gone is a policy decision rather than an implementation detail.
