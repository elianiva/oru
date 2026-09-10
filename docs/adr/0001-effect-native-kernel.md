# Effect-native kernel; no chord or cordis dependency

The kernel is built on Effect primitives (`Context`, `Scope`, `Stream`) rather than `@earendil-works/chord` or `cordis`. Foldkit is Effect-native, so a second composition runtime would create a permanent translation seam. Neither candidate supplies reactive coeffects, so the reactive layer has to be built regardless. We take their vocabulary and architecture — facets, stable service facades, reverse-order disposal, generation-based reload — without their runtime.

## Considered Options

- **chord** (the composition runtime in the pi monorepo): provides facets, remote services, replicated state, and reload, but brings its own context and service runtime, rejects late dependency acquisition, and its API is documented as unstable.
- **cordis**: provides the reactive coeffect semantics, but is an unstable second reactive runtime under Effect.
- **Own Effect kernel** (chosen): one runtime, one dependency-injection and cancellation model, domain vocabulary first-class.

## Consequences

The facet loader, remote boundary, and replicated state are oru's to build. Where an Effect-agnostic primitive already solves part of that — for example `@earendil-works/chord/delta` for delta encoding — prefer vendoring the primitive over adopting the whole runtime.
