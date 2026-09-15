# The kernel is Effect-native, with data-shaped declarations and generation reload

The kernel is built on Effect primitives (`Context`, `Scope`, `Stream`) rather than `@earendil-works/chord` or `cordis`. Foldkit is Effect-native, so a second composition runtime would create a permanent translation seam, and neither candidate supplies reactive coeffects, so the reactive layer has to be built regardless. We take their vocabulary and architecture, facets, stable service facades, reverse-order disposal, and generation-based reload, without their runtime.

Plugins declare coeffects as data and the kernel resolves the graph. The full graph is resolved statically at boot, and providers activate before consumers. At runtime the kernel watches the service registry and activates or deactivates plugins whose coeffects appear or disappear.

`definePlugin` takes `needs` (coeffect service tokens) and `provides` (contributions: services, tools, submodels) as data, plus optional `setup(ctx)` and a presentation facet. `setup` runs inside an Effect `Scope`. Because the declarations are data, the watcher diffs them instead of tracing calls, and the graph can be rendered in the UI before activation.

A facet is built into a content-addressed bundle per generation behind a `FacetLoader` seam. Reload loads the candidate generation, validates it, cuts over, then disposes the retired generation in reverse order. Peer dependencies are externalized and resolved against the host. This is the mechanism the reactive watcher runs on when plugins are added or removed at runtime.

## Considered options

- **chord** (the composition runtime in the pi monorepo): facets, remote services, replicated state, and reload, but its own context and service runtime, no late dependency acquisition, and an unstable documented API.
- **cordis**: the reactive coeffect semantics, but an unstable second reactive runtime under Effect.
- **Own Effect kernel** (chosen): one runtime, one dependency-injection and cancellation model, domain vocabulary first-class.
- **Static activation only**: reversible effects on `Effect.Scope` alone, but no spatial composability.
- **Reactive activation only**: the full spatial guarantee on every path, at the cost of carrying reactive resolution into boot.
- **Hybrid** (chosen): static resolution at boot, reactive resolution on runtime changes.
- **Fully declarative manifest** with no setup: an easy graph to reason about, but behavior needs a separate home.
- **Setup-call declarations** (cordis/chord style, `ctx.use` and `ctx.provide`): no parallel list, but the graph exists only at runtime and cannot be diffed or shown before activation.
- **Declarations plus optional setup** (chosen): the graph is inspectable and diffable, and behavior stays ordinary Effect code.
- **jiti with module hooks** (bb): a strong TypeScript and ESM development flow on Node, uncertain under Bun.
- **`node:vm` CommonJS generations** (pi/chord): deterministic unload with no module-cache involvement, but Node-only.
- **Native ESM with cache eviction** (dsh/cordis): needs `--expose-internals` and cannot reach `node_modules`.
- **Content-addressed bundles** (chosen): each generation is a unique module URL, so loading is fresh by construction on both Node and Bun, and a whole-facet bundle has no stale submodule problem. The address is the sha256 of the emitted module bytes. The loader imports a URL whose path ends in that address, so two hosts agree on identity even when their store directories differ.

## Consequences

- The facet loader, remote boundary, and replicated state are oru's to build. Where an Effect-agnostic primitive already solves part of that, for example `@earendil-works/chord/delta` for delta encoding, prefer vendoring the primitive over adopting the whole runtime.
- The service registry is observable, and declarations describe coeffects as data so the registry can diff them. Boot runs without the watcher, so a static graph is valid on its own.
- A declaration that disagrees with `setup` surfaces at activation in both directions: a declared service `setup` does not return (`ServiceMissing`), and a returned service the declaration never claimed (`ServiceUndeclared`, which nothing could resolve because the kernel publishes by declaration).
- Stable service facades survive provider replacement, so handles captured before a cutover keep working. A facade re-resolves its provider on every call and hands back the same kind of answer the method produced, so a reload never quietly changes what a caller is holding. An `Effect` stays an `Effect`, a `Stream` stays a `Stream`. A provider that changes a method's kind underneath a live caller is reported as `ProviderReturnKindChanged` rather than papered over.
- Peer dependencies must resolve to the host's copy, or a plugin gets a second runtime instance and Effect services stop matching.
- The browser facet gets the same reload behavior from Vite's build and HMR; the server facet uses the `FacetLoader`.
