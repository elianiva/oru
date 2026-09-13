# A plugin is one identity with facets, activated host-wide or per thread

A plugin is one identity with a manifest declaring its coeffects, plus one or more facets: a server facet, a presentation (Foldkit) facet, or both, bundled and loaded per environment. Facets of one plugin share its identity and coeffects but load separately. A presentation facet reaches the server only through a typed service facade and replicated state, never through direct imports.

A plugin activates at the host scope or at a thread scope. A thread's context is flat: it sees host-global contributions plus its own and does not inherit from a parent thread, so a subagent thread does not inherit its parent's tools.

## Considered options

- **Two separate plugin registries**, runtime versus UI: simpler loading, but the composability story breaks at the view layer and a plugin cannot contribute both cleanly.
- **One plugin, multiple facets** (chosen): matches how a feature is shaped, a tool plus the panel that shows it.
- **Host-global only**: one context, every contribution visible to every agent. Simple, but a thread-specific tool leaks everywhere.
- **Per-session/agent**: a layer per agent, closest to dsh, but sessions within a thread would duplicate tool sets and the user-facing thread would not own its behavior.
- **Host-global plus per-thread** (chosen): a thread is the user-facing unit and a subagent is a child thread, so thread scope gives subagents their own world without inheritance.

## Consequences

- `update` stays pure, so UI side effects flow through Commands that call service facades.
- Because facets load per environment, a presentation facet runs in a browser while the server facet runs in Node, without any change to plugin code.
- A thread context is created and disposed with its thread, so its contributions are reversible by construction. Registration scope and cleanup scope are the same.
- Two agents of one thread share its scope.
