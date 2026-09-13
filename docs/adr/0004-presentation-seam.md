# The presentation facet talks to the server over typed RPC, and the view mirrors the active graph

A presentation facet reaches server services through a typed RPC boundary (`effect/unstable/rpc` over a transport) and receives state as replicated streams. It never imports server code or shares process memory with the server.

The root submodel holds a keyed collection of active plugin submodels. Activation adds an entry and deactivation removes it, as ordinary messages in the update loop, so the render never observes a half-added plugin. The view folds over the live entries, and each child's OutMessages bubble to the root through the same update loop.

## Considered options

- **In-process service calls**: least machinery, but it assumes the presentation facet shares a process with the server, which a browser presentation facet does not.
- **Vendored chord wire grammar**: an existing remote-service boundary, but it is not oru's experiment, and its runtime is rejected in ADR-0001.
- **Typed RPC from the start** (chosen): the boundary matches how facets deploy, and commands and state streams are transport-shaped from the outset.
- **Static composition**: every plugin's UI is always mounted, shown or hidden by state. Simple, but a deactivated plugin still occupies the tree and its state persists after deactivation.
- **Imperative mount/unmount** from facet code: bypasses the single update loop and reintroduces hidden state.
- **Dynamic keyed composition** (chosen): the view is a projection of the active graph, matching the log-driven state model.

## Notes

Effect v4 merged the former `@effect/*` packages into `effect` under `effect/unstable/*`; RPC, SQL, and HTTP live there. Only platform- and provider-specific packages remain separate.

## Consequences

- Kernel services that cross the seam are JSON-serializable; process-local services stay local.
- State streams carry snapshot and delta semantics so hydration is race-free.
- The RPC contract is derived from the same service tokens plugins already declare.
- A keyed collection of submodels is less proven in Foldkit than a static child and needs a prototype before it is relied on.
