# A host that does not answer is a rendered state, not a defect

The client facades in `packages/rpc/src/client.ts` reported every failure by dying: each method ended in `Effect.orDie`, so a host that was down, a proxy that answered nothing, or an answer that could not be framed all took the app down instead of showing a state. The app is a client of a running host, and "the host is not answering" is a condition of a client, not a broken invariant of the process.

## Decision

`HostUnreachable { operation, reason }` is a `Schema.TaggedError` on every facade method's error channel, in `@oru/rpc`. A facade converts the transport failure and leaves the host's own refusals (`RelativeCwd`, `UnknownProject`, `UnknownThread`) alone, so a caller reads the refusals its call actually declares. Defects stay defects: only a typed failure becomes `HostUnreachable`, never an exception from the mapping code itself.

The app renders that state. `ListProjects` is the app's first call and its liveness probe, so its result — a list, an empty list, or `HostUnreachable` — is the app's own state (`apps/oru/src/projects.ts`). A host that did not answer replaces the shell with a named `Host unreachable` state, its reason, and a retry; the retry dispatches the same command again. A host that answered with no projects renders an empty state, which is a fact too.

## Considered options

- **Catch defects in the commands** (`Effect.catchDefect` around each call): a facade that dies makes a transport failure indistinguishable from a bug in the mapping code, so the app would have to swallow both. Rejected.
- **A second facade layer that maps errors for the app**: the seam exists once; a mapping layer next to it is a second client path to keep in step. Rejected.
- **A generic mapping helper over any error union**: TypeScript cannot subtract the transport error from a free `E`, so the helper would widen every method's error channel with a type the caller cannot handle. Rejected in favour of concrete per-union helpers.

## Consequences

- A facade call never dies on a host that is down; `apps/host/test/*` and `apps/oru/test/seam.test.ts` name `HostUnreachable` where a helper previously proved `never`.
- `apps/oru/src/entry.ts` still hands the same `clientsFor(hostUrl)` layer to the runtime; nothing else wires a client.
- Every later issue in the first UI slice renders its own failures through this channel rather than adding another.
