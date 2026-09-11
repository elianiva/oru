# The session is an immutable event log; runtime state is a projection

A session is an append-only `SessionEvent` log. Every model-visible fact and every host fact is appended to it, and all runtime state is a projection of the log. A plugin's server facet folds the log into state and derives work; the agent runtime executes that work and appends the results. The log is also the trace.

## Considered Options

- **Mutable transcript owned by the runtime**: simplest, but durability, replay, and inspection depend on runtime-specific snapshots.
- **Log as a durable mirror**: the runtime is authoritative in-process and the log only records. Cheaper, but resume, fork, and crash recovery need bespoke snapshot logic, and the trace can drift from state.
- **Log-driven projection** (chosen): the log is authoritative and all state is derived from it.

## Consequences

- Resume, fork, and crash recovery reproject the log instead of restoring a snapshot.
- The event vocabulary covers model-visible facts (`turn/started`, `turn/failed`, `message/appended`, `tool/requested`, `tool/completed`) and host facts (`plugin/activated`, `plugin/deactivated`), so the trace shows how the plugin graph shaped a run.
- A server facet is a Moore machine: `output(state)` derives a view and the transitions it enables, and composed server facets reconcile their views and transitions. This model is borrowed from Tardigrade.
- Effects execute at least once, so a transition key makes reruns idempotent.
- Runtime events from effect-uai are projected into this vocabulary at the seam, so the log does not leak runtime types.
