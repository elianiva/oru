# Facets reload as content-addressed bundle generations

A facet is built into a content-addressed bundle per generation. Reload loads the candidate generation, validates it, cuts over, then disposes the retired generation in reverse order. Peer dependencies are externalized and resolved against the host, so plugins share the host's runtime. The mechanism sits behind a `FacetLoader` seam.

## Considered Options

- **jiti with module hooks** (bb): strong TypeScript and ESM development flow on Node, uncertain under Bun.
- **`node:vm` CommonJS generations** (pi/chord): fully deterministic unload with no module-cache involvement, but Node-only.
- **Native ESM with cache eviction** (dsh/cordis): needs `--expose-internals` and cannot reach `node_modules`.
- **Content-addressed bundles** (chosen): each generation is a unique module URL, so loading is fresh by construction on both Node and Bun, and a whole-facet bundle has no stale submodule problem.

## Consequences

- Stable service facades survive provider replacement, so handles captured before a cutover keep working.
- Peer dependencies must resolve to the host's copy, or a plugin gets a second runtime instance and Effect services stop matching.
- The browser facet gets the same behavior from Vite's build and HMR; the server facet uses the `FacetLoader`.
- This is the mechanism that ADR-0004's reactive activation runs on when plugins are added or removed at runtime.
