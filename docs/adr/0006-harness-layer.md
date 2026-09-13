# Many harnesses on one host: a registry, declared session ownership, thread configuration

A host keeps several harnesses active at once. A harness plugin contributes its service as a data contribution under `HarnessKind` (`oru/harness`), the same way a tool plugin contributes under `ToolKind`. A small `oru/harness-registry` plugin provides the `Harnesses` service, which answers from the live contribution set, and `oru/inference` needs `Harnesses` instead of a single `Harness`. A thread records which harness it runs, and the runtime resolves it per turn.

The harness contract carries two session patterns, declared by `HarnessCapabilities.ownsHistory`. A model-turn harness (`harness-oru`) is stateless: the runtime replays `request.history` every turn, and the session log is the conversation. An agent-run harness (`harness-pi`) owns a session of its own: it seeds that session from `request.history` when it has nothing for the thread, and afterwards treats its own state as authoritative for the model while the log is the trace. The runtime still receives every fact: an agent-run harness reports the turn's items (assistant messages, tool calls, tool outputs, usage) and the runtime appends them.

Which harness a thread runs, which model it uses, and how much it thinks are thread facts, appended as a `thread/configured` event and folded into thread state. `ThreadRpc` gains `ConfigureThread`, the harness request carries the result, and the thread pane offers the three choices as dependent selects.

`HarnessEvent` is `TurnEvent | HarnessLifecycle`. `HarnessLifecycle` is what a turn-scoped union cannot express: `CompactionStarted`, `CompactionEnded`, `ContextWindow`, `SessionReplaced`, `ProviderWarning`, `ProviderError`, `RawUnhandled`. The harness reports and the runtime records. Where the log has a home for a fact (`thread/compacted`), the runtime appends it. Where it does not yet (context window, warnings), the event streams to the presentation facet and stops there.

## Considered options

- **One `Harness` token, swapped per host** (previous): one harness per host. Two harnesses collide as `DuplicateProvider`, and swapping the running one is a `host.replace` that changes every thread at once.
- **Per-thread plugin scope** (ADR-0002): the oru-native answer and where this ends up, but the registry is a flat map keyed by token and activation scopes are keyed by plugin, so it needs a scoped registry first. Nothing here depends on it.
- **`HarnessKind` contribution plus a `Harnesses` registry** (chosen): the kernel already carries opaque contribution payloads (`defineContributionKind`), so two harness plugins never collide on a token, activation stays the plugin's own business, and the view keeps mirroring the active graph.
- **Always replay history, harness state ephemeral**: one authority, the log, but a foreign agent's session-level features, resume, checkpoint fork, vendor compaction, its own file history, have nothing to attach to.
- **Harness state authoritative, the log unused**: bb without a runtime. oru's log stops being the trace of the run.
- **Both, declared by capability** (chosen): the runtime keeps its rule for the harnesses that want it, and a foreign agent keeps its own memory without pretending otherwise.
- **The harness writes `SessionLog` itself**: it already has the coeffect, so no API change at all, but then one lane has two writers and ordering stops belonging to the runtime.
- **`TurnEvent` only**: compaction, context window, and session replacement are dropped, and a foreign agent's session-level behavior becomes invisible to oru.
- **`TurnEvent | HarnessLifecycle`, recorded by the runtime** (chosen): one writer per lane, and the bridge's job stays translation.
- **Per-host configuration**: one harness and one model for everything. Cannot express the case this exists for, two threads doing different work.
- **Fields on `thread/created`**: no way to change your mind without a new thread, and changing the model is an ordinary act, not a new conversation.
- **A `thread/configured` fact** (chosen): the same shape as every other thread fact, foldable, replayable, and changeable.

## Consequences

- `@oru/harness` exports `HarnessKind`, the `Harnesses` service and token, and the `HarnessService` interface. `Harness` as a token is gone, and every caller migrated in one cut: inference, harness-oru, harness-pi, the app's fixtures, and the architecture test.
- Inference activates whether or not a harness is installed. A thread naming an unknown harness fails at its turn, not at boot. The registry answers from contributions on each call, so activating or deactivating a harness plugin changes what the picker offers without a restart.
- `Harnesses` appears in the graph's service tokens, so the presentation facet lists harnesses without importing the inference plugin (ADR-0005).
- A bridge whose service is assembled from a coeffect contributes at setup rather than after activation, so `PluginContext` carries `contribute`: a plugin adds to its own contribution set while it is being set up, and deactivating it reverses every contribution by plugin id (ADR-0001). `harness-pi` needs this because its service is built from the process environment it was handed, not from anything the host injects later. A harness plugin's own coeffects are unchanged; only its provision changes from a token to a contribution.
- ADR-0003 still holds for the runtime: oru's state is a projection of the log. For an `ownsHistory` harness the log is the trace and the harness's session is the model's memory. Two authorities, one declared boundary.
- A thread with no harness session, forked, branched, or on a fresh host, is re-seeded from `request.history`. The log is what makes re-seeding possible at all.
- `HarnessTurnRequest` gains `cwd` (an agent-run harness is cwd-bound at session construction) and `instructions`, so the runtime hands over what the thread's project owns instead of the harness reading the log for it.
- The picker is three dependent selects in the thread pane: harness from `Harnesses`, model from the chosen harness's catalog, thinking level from the chosen model's levels. Model catalog entries grow per-model reasoning levels and a default.
- Changing harness or model on a live thread is a configuration change, not a new thread. What happens to an agent-run session underneath is the harness's business, and it says so by reporting `SessionReplaced`.
- Branch, fork, and compaction are unaffected: the configuration is a fact like any other, so reproduction from the log does not depend on it.
- `CreateThread` takes a real `cwd`, so `project/created` stops recording `'.'`. The request's `cwd` comes from the thread's project. The app's architecture test no longer asserts a fixed active-plugin set for harnesses, because which harnesses are active is a runtime choice.
- `thread/compacted` needs a summary, and pi's `compaction_end` event carries none. The bridge reads pi's own session entries to fill the fact honestly rather than appending an empty one. If pi's session format makes that unreliable, the fallback is to surface compaction as a lifecycle event only, reported to the user, not silently hollowed out.
- `SessionReplaced` is how a harness tells the runtime that the model's memory changed underneath a live thread: a model or thinking level change rebuilt the session, or the thread was forked.
- Unmapped provider events are kept as `RawUnhandled` instead of dropped, so the trace stays honest about what the bridge did not understand.
- Context window and provider warnings have no session-log home yet. When they earn one, the change is in the runtime, not in every harness.
