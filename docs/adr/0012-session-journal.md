# Session events persist through the Effect event journal

A session's events are stored in Effect's `EventJournal` (`effect/unstable/eventlog`), reached through an oru `SessionLog` service. The journal is in-memory for early work and SQLite-backed (`@effect/sql-sqlite-node`) for durability, with the same interface across both. Projections are folded by server facets, not by the journal.

## Considered Options

- **Hand-rolled append-only table**: full control of vocabulary and projection, at the cost of reimplementing replay, change subscription, and storage backends.
- **Per-thread SQLite files** (Tardigrade): simple fork by file copy, but many small stores and a bespoke durability story.
- **Effect `EventJournal`** (chosen): durable journal, replay, and change subscriptions from the platform, with memory, IndexedDB, and SQL layers behind one interface.

## Consequences

- `SessionLog` exposes `write`, `entries`, and `changes`; the projection fold belongs to server facets, so the journal stays a transport for facts.
- The memory-to-SQL swap needs no interface change, so early work runs without a database.
- `effect/unstable/eventlog` is unstable; pin the version and expect breakage.
- The journal's remote synchronization is available to the presentation seam later.
