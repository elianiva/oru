# Thread configuration is harness, then model, then thinking level

Which harness a thread runs, which model it uses, and how much it thinks are thread facts. They are appended as a `thread/configured` event and folded into thread state. `ThreadRpc` gains `ConfigureThread`, the harness request carries the result, and the thread pane offers the three choices as dependent selects. Model catalog entries grow per-model reasoning levels and a default so the second and third steps have something to offer.

## Considered options

- **Per-host configuration**: one harness and one model for everything. Cannot express the case this exists for — two threads doing different work.
- **Fields on `thread/created`**: no way to change your mind without a new thread, and changing the model is an ordinary act, not a new conversation.
- **A `thread/configured` fact** (chosen): the same shape as every other thread fact, foldable, replayable, and changeable.

## Consequences

- The picker is three dependent selects in the thread pane: harness from `Harnesses`, model from the chosen harness's catalog, thinking level from the chosen model's levels.
- Changing harness or model on a live thread is a configuration change, not a new thread. What happens to an agent-run session underneath is the harness's business, and it says so by reporting `SessionReplaced` (ADR-0020).
- Branch, fork, and compaction are unaffected: the configuration is a fact like any other, so reproduction from the log does not depend on it.
- `CreateThread` takes a real `cwd`, so `project/created` stops recording `'.'`. The request's `cwd` comes from the thread's project.
- The app's architecture test no longer asserts a fixed active-plugin set for harnesses, because which harnesses are active is a runtime choice.
