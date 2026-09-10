# Plugin scope: host-global and per-thread

A plugin activates at the host scope or at a thread scope. A thread's context is flat: it sees host-global contributions plus its own and does not inherit from a parent thread, so a subagent thread does not inherit its parent's tools.

## Considered Options

- **Host-global only**: one context, every contribution visible to every agent. Simple, but a thread-specific tool leaks everywhere.
- **Per-session/agent**: a layer per agent, closest to dsh, but sessions within a thread would duplicate tool sets and the user-facing thread would not own its behavior.
- **Host-global plus per-thread** (chosen): a thread is the user-facing unit and a subagent is a child thread, so thread scope gives subagents their own world without inheritance.

## Consequences

- A thread context is created and disposed with its thread, so its contributions are reversible by construction.
- Registration scope and cleanup scope are the same: a thread-scoped contribution is disposed when the thread is.
- Two agents of one thread share its scope.
