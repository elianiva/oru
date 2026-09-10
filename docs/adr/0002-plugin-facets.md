# A plugin unifies runtime and UI as facets

A plugin is one identity with a manifest declaring its coeffects, plus one or more facets: a server facet, a presentation (Foldkit) facet, or both, bundled and loaded per environment. Facets of one plugin share its identity and coeffects but load separately. A presentation facet reaches the server only through a typed service facade and replicated state, never through direct imports.

## Considered Options

- **Two separate plugin registries** (runtime plugin vs UI plugin): simpler loading, but the composability story breaks at the view layer and a plugin cannot contribute both cleanly.
- **One plugin, multiple facets** (chosen): matches how a feature is shaped, a tool plus the panel that shows it.

## Consequences

`update` stays pure, so UI side effects flow through Commands that call service facades. Because facets load per environment, a presentation facet runs in a browser while the server facet runs in Node without any change to plugin code.
