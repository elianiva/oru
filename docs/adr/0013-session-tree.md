# Session events form a pi-style tree per lane

The session log stays the authority (ADR-0007). Each fact is a `SessionEvent` with storage-assigned `parentId`, `seq`, and `timestamp`. Host facts (`plugin/*`, `project/created`) share the `host` lane. Each thread is its own lane. The current conversation is the path from that lane's leaf back to a null parent. Abandoned siblings stay in the journal and drop off the path.

`SessionLog.write` takes a draft (no tree fields), stamps the envelope, and serializes writes so two facts cannot share a leaf.

## Considered options

- Replace `SessionEvent` with pi `Entry` types (`message`, `compaction`, …). Lost the oru seam that keeps effect-uai out of the log.
- Pi compact on a linear log, tree later. Rejected: `/tree` and `branch_summary` need parent links.
- Two logs (transcript tree + host linear). Two authorities.

## Consequences

- Fold work and model history walk `pathOfLane` / `modelVisiblePath`, not the raw journal order.
- `thread/compacted` and `thread/branched` are facts on the thread lane. Compaction logic (pi cut-point + summary) lives in an inference-adjacent plugin, not the kernel.
- A `project/created` fact holds `name` and `cwd`. Many projects live on one host. Threads point at a project.
