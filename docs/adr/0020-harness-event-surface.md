# Harness events carry session facts, and the runtime records them

`HarnessEvent` becomes `TurnEvent | HarnessLifecycle`. `HarnessLifecycle` is what a turn-scoped union cannot express: `CompactionStarted`, `CompactionEnded`, `ContextWindow`, `SessionReplaced`, `ProviderWarning`, `ProviderError`, `RawUnhandled`. The harness reports; the runtime records. Where the log has a home for a fact (`thread/compacted`), the runtime appends it. Where it does not yet (context window, warnings), the event streams to the presentation facet and stops there.

## Considered options

- **The harness writes `SessionLog` itself**: it already has the coeffect, so this needs no API change at all — but then one lane has two writers and ordering stops belonging to the runtime.
- **`TurnEvent` only**: compaction, context window, and session replacement are dropped, and a foreign agent's session-level behaviour becomes invisible to oru.
- **`TurnEvent | HarnessLifecycle`, recorded by the runtime** (chosen): one writer per lane, and the bridge's job stays translation.

## Consequences

- `thread/compacted` needs a summary, and pi's `compaction_end` event carries none. The bridge reads pi's own session entries to fill the fact honestly rather than appending an empty one. If pi's session format makes that unreliable, the fallback is to surface compaction as a lifecycle event only — reported to the user, not silently hollowed out.
- `SessionReplaced` is how a harness tells the runtime that the model's memory changed underneath a live thread: a model or thinking level change rebuilt the session, or the thread was forked.
- Unmapped provider events are kept as `RawUnhandled` instead of dropped, so the trace stays honest about what the bridge did not understand.
- Context window and provider warnings have no session-log home yet. When they earn one, the change is in the runtime, not in every harness.
