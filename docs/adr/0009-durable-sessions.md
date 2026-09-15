# Durable sessions in the host: the log is opened, resumed, and reprojected

ADR-0003 promised that resume, fork, and crash recovery reproject the log. This is the decision that makes that a product behavior. A node host opens one SQLite file as its journal, reconstructs the plugin graph from `plugin/*` facts, and resumes every lane that has outstanding work. A fork writes the entry it continues from rather than copying facts, and a compaction records the entry its view keeps from. All three survive a restart because all three are read back out of the log.

## The journal is a file the host opens

`sqliteJournalLayer(filename)` provides an `EventJournal` backed by a node SQLite client, and a host composes it the way the browser host composes `EventJournal.layerMemory`: `sessionLogLayer` and `makeHost` resolve the same journal, from one connection. It is the kernel's only node entry point (`@oru/kernel/sqlite`), so the browser host never pulls a filesystem driver into its bundle. Two host instances against one file are the restart case the tests drive.

## Opening the journal resumes the lanes it names

Open is where a thread's state stops being assumed. The inference loop folds every thread the log names and kicks the ones whose `workOf(foldThread(...))` is not `Idle`, so a thread killed mid-turn continues that turn instead of idling forever. The `idle` map records what is draining now, not what the log says about the work. A turn that dies between `turn/started` and its completion is re-run under the same turn id, and a `tool/requested` with no `tool/completed` runs again: effects execute at least once, and the fold is what decides.

That resume runs as a boot step, not from the loop's own activation. Activation order follows declared needs, so a loop can activate before the bridge or the tool it reads, and resuming then would append a false `turn/failed` or a false `tool/completed` to an append-only log. `BootKind` is a contribution a plugin makes with work that needs the whole graph, and the host runs those once its activation pass is done. The contribution mechanism is already there, so no plugin gains a second lifecycle method for this.

## A fork is a link, not a copy

`thread/branched` carries `fromId`, the entry in the source lane the new lane continues from, and an optional summary for what the branch left behind. `pathOfLane` stays lane-local, so the fork's own fold starts idle: it does not inherit the source's outstanding turn and does not re-run it under a second thread id. `modelVisiblePath` resolves ancestry through `fromId`, so the model's memory of the fork is the source's path to that entry plus the fork's own facts.

The ancestry is read from the branch point backwards, over facts that already existed when the branch was written. A fork's memory is therefore fixed by the log at fork time: a source that keeps talking, forks again, or compacts cannot change it. Forking the leaf of a compacted source inherits the compaction summary, because that summary is inside the path the branch names.

The harness is asked to copy its own session when it has `fork`, and is not asked when it does not. ADR-0006 already has the rule for a harness with no session for a thread: it is re-seeded from `request.history`, and the log is what makes re-seeding possible. Fork must not require a harness capability, because a restart is exactly the case where the harness's snapshot is not the authority.

## One authority for the compaction cut

`compactionCut(events, thread)` is the entry a compacted view keeps from: the latest `message/appended` with role `user` on the model-visible path, falling back to the lane leaf. Both the requested `CompactThread` and the automatic compaction a harness reports during a turn use it, so the cut point is a property of the log rather than of whichever path wrote the fact. The summary is still the harness's, because a summary is model work; a harness with no `compact` still cannot compact its session.

## Considered options

- **Copy the source lane's facts into the target lane** (pi copies a session file this way): no change to path resolution, but the journal doubles per fork, ids must be remapped so `pathFromLeaf`'s id map stays unambiguous, an earlier compaction's `firstKeptEntryId` must be rewritten to a copied id, and the target lane's fold inherits the source's outstanding turn under a new thread id.
- **Relink the branch's `parentId` to the source leaf**: the lane's own path then includes its ancestors with no copying, but `SessionLog.write` would need to accept an explicit parent, against ADR-0003's rule that the write stamps the parent from the lane's leaf, and `foldThread` would read the source's messages as the fork's own work.
- **Resolve ancestry in `modelVisiblePath`** (chosen): the write path and `pathOfLane` keep their invariants, work state stays per-lane, and only the projection that the model reads crosses the branch. The ancestry is read from the branch point backwards, so what the fork remembers is written once and cannot drift.
- **Resume from the loop's setup**: no new lifecycle surface, but a lane then resumes against whatever part of the graph happens to be installed first.
- **A `started` method on every plugin**: the same timing without a contribution, at the cost of a second lifecycle method every plugin carries and the host must sequence.
- **A host-level lifecycle call**: the persistence layer would have to know about threads. The loop that owns the drain is the one that can start it.
- **Require a compact-capable harness to append `thread/compacted`**: the fact would come and go with whichever bridge is active, and the view a restart reprojects would depend on that.
- **Put the durable store in the app**: the kernel owns `SessionLog` and the journal behind it, and the app would then own two journal implementations.
- **Export the SQLite layer from the kernel's browser surface**: `apps/oru` bundles the kernel, so a filesystem driver would join the browser build.

## Consequences

- `ThreadBranched` loses `readFiles` and `modifiedFiles` and its `summary` becomes optional. Nothing produced those file lists, and a fact no one writes is a promise the schema cannot keep. `historyOf` appends a branch summary only when there is one.
- A fork of a fork chains: a lane's memory is the path its branch names, read only over entries that already existed, and an entry already walked is skipped, so a log that names an entry twice cannot recurse forever.
- `thread/compacted` on a fork lane may name an entry in an ancestor lane. The cut is an entry id, not a lane-local index, so that is ordinary.
- A harness that cannot fork still forks: the new lane is correct from the log, and an `ownsHistory` harness seeds its fresh session from the fork's model-visible history.
- The browser host has no durable journal until the node host process exists (issue #10). Until then the two-instance tests are the proof that the storage and the reprojection are real.
- `compactionCut` narrows what a compacted thread keeps to its latest request. A thread with no request of its own, or one compacted twice with nothing in between, keeps its leaf.
- Two fold defects surfaced while the lanes were replayed across hosts, and both are fixed here. The fold kept a turn open after the model answered, so the next request reused the answered turn's id and wrote no `turn/started` of its own. And a completed tool call was keyed by call id alone, so a bridge that reuses an id in a later turn had its new call treated as already run and never executed it.
- A fork's pane shows its own lane, not the memory it inherited, because `WatchThread` streams lane facts. The model and the transcript therefore disagree until the fork writes a fact of its own. Showing the memory in the pane is a presentation change, not a kernel one, and it is not part of this decision.
- A boot step runs for the graph the host opened with. A plugin activated later joins the live graph without one, so a loop brought up after boot resumes a lane when that lane next receives work rather than at that moment.
