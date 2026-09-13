# A harness may own its conversation; history is bootstrap material

The harness contract carries both patterns. A model-turn harness (`harness-oru`) is stateless: the runtime replays `request.history` every turn and the session log is the conversation. An agent-run harness (`harness-pi`) owns a session of its own: it seeds that session from `request.history` when it has nothing for the thread, and afterwards treats its own state as authoritative for the model. `HarnessCapabilities.ownsHistory` declares which pattern, so the arrangement is stated rather than inferred.

## Considered options

- **Always replay history, harness state is ephemeral**: one authority (the log), but a foreign agent's session-level features — resume, checkpoint fork, vendor compaction, its own file history — have nothing to attach to.
- **Harness state authoritative, the log unused**: bb without a runtime. oru's log stops being the trace of the run.
- **Both, declared by capability** (chosen): the runtime keeps its rule for the harnesses that want it, and a foreign agent keeps its own memory without pretending otherwise.

## Consequences

- ADR-0007 still holds for the runtime: oru's state is a projection of the log. For an `ownsHistory` harness the log is the trace and the harness's session is the model's memory — two authorities with one declared boundary, which is worth its own sentence in the glossary.
- The runtime still receives every fact. An agent-run harness reports the turn's items (assistant messages, tool calls, tool outputs, usage) and the runtime appends them.
- A thread with no harness session — forked, branched, or on a fresh host — is re-seeded from `request.history`. The log is what makes re-seeding possible at all.
- `HarnessTurnRequest` gains `cwd` (an agent-run harness is cwd-bound at session construction) and `instructions`, so the runtime can hand over what the thread's project owns instead of the harness reading the log for it.
