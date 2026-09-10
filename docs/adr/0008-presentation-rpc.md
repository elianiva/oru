# The presentation facet talks to the server over typed RPC

A presentation facet reaches server services through a typed RPC boundary (`effect/unstable/rpc` over a transport) and receives state as replicated streams. It never imports server code or shares process memory with it.

## Considered Options

- **In-process service calls**: least machinery, but assumes the presentation facet shares a process with the server, which a browser presentation facet does not.
- **Typed RPC from the start** (chosen): the boundary matches how facets deploy, and commands and state streams are transport-shaped from the outset.
- **Vendored chord wire grammar**: an existing remote-service boundary, but it is not oru's experiment and its runtime is rejected in ADR-0001.

## Notes

Effect v4 merged the former `@effect/*` packages into `effect` under `effect/unstable/*`; RPC, SQL, and HTTP live there. Only platform- and provider-specific packages remain separate.

## Consequences

- Kernel services that cross the seam are JSON-serializable; process-local services stay local.
- State streams carry snapshot and delta semantics so hydration is race-free.
- The RPC contract is derived from the same service tokens plugins already declare.
