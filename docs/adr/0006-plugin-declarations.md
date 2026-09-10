# Plugin declarations are data; setup wires behavior

`definePlugin` takes `needs` (coeffects: service tokens) and `provides` (contributions: services, tools, submodels) as data, plus optional `setup(ctx)` and a presentation facet. The kernel reads the declarations to resolve and watch the graph; `setup` runs inside an Effect `Scope`.

## Considered Options

- **Fully declarative manifest** with no setup: the graph is easy to reason about, but behavior needs a separate home.
- **Setup-call declarations** (cordis/chord style): `setup` calls `ctx.use` and `ctx.provide`, so there is no parallel list, but the graph exists only at runtime and cannot be diffed or shown before activation.
- **Declarative needs and provides plus optional setup** (chosen): the graph is inspectable and diffable, and behavior stays ordinary Effect code.

## Consequences

The reactive watcher in ADR-0004 diffs declarations instead of tracing calls, and the graph can be rendered in the UI. A declaration that disagrees with `setup` behavior surfaces at activation.
