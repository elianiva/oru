# The session is an immutable event log, projected as state, stored as a tree per lane

A session is an append-only `SessionEvent` log, and every model-visible fact and every host fact is appended to it. All runtime state is a projection: a plugin's server facet folds the log into state and derives work, and the agent runtime executes that work and appends the results. The log is also the trace.

Each fact carries storage-assigned `parentId`, `seq`, and `timestamp`. Host facts (`plugin/*`, `project/created`) share the `host` lane, and each thread is its own lane. The current conversation is the path from that lane's leaf back to a null parent. Abandoned siblings stay in the journal and drop off the path.

Events persist through Effect's `EventJournal` (`effect/unstable/eventlog`), reached through an oru `SessionLog` service. The journal has an in-memory layer and a SQLite-backed layer (`@effect/sql-sqlite-node`) with the same interface. Projections are folded by server facets, not by the journal.

## Considered options

- **Mutable transcript owned by the runtime**: simplest, but durability, replay, and inspection depend on runtime-specific snapshots.
- **Log as a durable mirror**: the runtime is authoritative in-process and the log only records. Cheaper, but resume, fork, and crash recovery need bespoke snapshot logic, and the trace can drift from state.
- **Log-driven projection** (chosen): the log is authoritative and all state is derived from it.
- **Hand-rolled append-only table**: full control of vocabulary and projection, at the cost of reimplementing replay, change subscription, and storage backends.
- **Per-thread SQLite files** (Tardigrade): simple fork by file copy, but many small stores and a bespoke durability story.
- **Effect `EventJournal`** (chosen): durable journal, replay, and change subscriptions from the platform, with memory, IndexedDB, and SQL layers behind one interface.
- **Replace `SessionEvent` with pi `Entry` types**: loses the oru seam that keeps provider types out of the log.
- **Pi compact on a linear log, tree later**: rejected because `/tree` and `branch_summary` need parent links.
- **Two logs**, transcript tree plus host linear: two authorities.

## Consequences

- Resume, fork, and crash recovery reproject the log instead of restoring a snapshot.
- The event vocabulary covers model-visible facts (`turn/started`, `turn/failed`, `message/appended`, `tool/requested`, `tool/completed`) and host facts (`plugin/activated`, `plugin/deactivated`), so the trace shows how the plugin graph shaped a run. Harness deltas are projected into this vocabulary by the assembler, so the log does not leak provider types.
- A server facet is a Moore machine: `output(state)` derives a view and the transitions it enables, and composed server facets reconcile their views and transitions. This model is borrowed from Tardigrade.
- Effects execute at least once, so a transition key makes reruns idempotent.
- `SessionLog` exposes `write`, `entries`, and `changes`. `write` takes a draft with no tree fields, stamps the envelope, and serializes writes so two facts cannot share a leaf. The projection fold belongs to server facets, so the journal stays a transport for facts.
- The memory-to-SQL swap needs no interface change. `effect/unstable/eventlog` is unstable, so pin the version and expect breakage. The journal's remote synchronization is available to the presentation seam later.
- Fold work and model history walk `pathOfLane` / `modelVisiblePath`, not the raw journal order.
- `thread/compacted` and `thread/branched` are facts on the thread lane. Compaction logic (pi cut-point plus summary) lives in the harness bridge, not the kernel.
- A `project/created` fact holds `name` and `cwd`. Many projects live on one host, and threads point at a project.
