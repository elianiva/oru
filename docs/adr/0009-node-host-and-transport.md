# A node host process serves the kernel over HTTP, and the browser app is its client

`apps/host` (`@oru/host`) is the process: it composes `makeHost(hostPlugins)`, mounts `HostRpc` and `ThreadRpc` over `effect/unstable/rpc`'s HTTP protocol on loopback, and ships the `oru-host` bin. Its plugin set is the one a browser cannot carry, because `oru/harness-pi` spawns `pi`. `apps/oru` stops constructing a kernel: it obtains `GraphRpc` and `ThreadClient` from `@oru/rpc` over that transport, and no `RpcTest` import remains in its source.

The seam is a workspace package, `@oru/rpc`, not a directory in the app or a subpath of the kernel. The RPC groups, the wire schemas, the client facades, and the two route paths live there, so both ends derive the boundary from one place and a second presentation facet cannot guess it. `@oru/kernel` was the other candidate and is the wrong layer: the wire carries `HarnessHealth` and `ModelInfo`, which would make the composition runtime depend on the harness layer. `@oru/host` re-exports nothing of the seam; the browser depends on `@oru/rpc` alone.

Serialization is NDJSON. With unframed JSON the client's HTTP protocol buffers the whole response before decoding it, so `WatchGraph`, `WatchThread`, and `WatchSignals` would never stream. The library decides this, not a preference: `includesFraming` is what makes the client read `response.stream`, and the transport module exports the one layer both ends use.

The host binary runs TypeScript from source under node's type stripping, with no build step. That is a constraint on the whole workspace rather than a property of the host: `erasableSyntaxOnly` is on in `tsconfig.base.json`, so a parameter property or an enum fails `pnpm typecheck` instead of failing at startup. It also retired two bundler contracts that only vitest had been hiding: `harness-pi` reads `oru-pi-extension.mjs` from disk instead of importing it `?raw`, and the four parameter properties under `plugins/harness-pi/src/pi` are declared fields.

The view stops needing any plugin knowledge. `ViewGraph.active` already meant "the panels", so the host now decides it by decoding `plugin.ui`, and the view keys its panel collection off the graph. The graph also answers `agent`, because the view's real question is whether a thread has anything to run, not which plugin provides the agent loop.

## Considered options

- **Keep the kernel in the browser and add a second host later**: the page is where the kernel is today, and a `pi` bridge can never be there. Every other issue in the graph is unverifiable without a process that can spawn one.
- **A WebSocket transport** (`RpcServer.layerHttp` defaults to it, and `Socket.layerWebSocketConstructorGlobal` is `new globalThis.WebSocket`, so the browser needs no dependency): it holds one connection per group instead of one per open stream, and in `effect` 4.0.0-rc.112 it keeps a five-second ping so a dead host fails a call instead of hanging it, then reconnects on a capped backoff. It was not taken because the work it needs is not this issue's: a shutdown hangs until the host tracks and destroys its sockets, and this host's shutdown is what stops the pi children, so that is a regression to solve rather than a detail; and its reconnect needs a resync marker, or a replayed `WatchThread` snapshot duplicates a transcript. My earlier probe of it failed and I did not establish why, so it is not evidence against the transport; two clean probes streamed over it, but neither took the app's shape.
- **A hand-rolled `HttpServer` over `node:http`, no platform dependency**: `@effect/platform-node` is twelve lockfile entries, including a `redis` peer that only its barrel needs. Writing the request and response adapter means owning body streaming, aborts, and header encoding, which is the part worth not owning.
- **The kernel owns the seam**: one import for both ends, and the browser bundle keeps the composition runtime it just stopped needing.
- **A subpath export of the host app**: no new package, but `apps/oru` would import a node application and inherit its dependency graph.
- **One RPC group on one path**: `RpcGroup.merge` would give one client and one socket. Rejected because the view holds two independent facades, and a group that stops answering should not take the other down.
- **The host serves the built app as well**: one command for a user, and no proxy. Deferred to the packaging issue, because the static-file story belongs with it.

## Notes

`@effect/platform-node` must be imported by subpath, `@effect/platform-node/NodeHttpServer`. Its barrel re-exports `NodeRedis`, which imports `redis` at module scope.

`pnpm-workspace.yaml` pins `@effect/platform-node-shared` to `4.0.0-rc.112`. The platform package accepts any `4.0.0-rc` of its shared half, the lockfile resolved `rc.115`, and `rc.115` imports `effect/ByteSize` and `effect/unstable/net/NetAddress`, neither of which the pinned `effect` ships. It fails at import, not at runtime use.

The record is `EventJournal.layerMemory`, so facts live as long as the process. The durable journal is its own issue, and `serveHost` is where it lands.

## Consequences

- `--help`, `--version`, `--host`, and `--port` are the whole CLI, parsed by hand because a CLI framework is a dependency for four flags. `--port 0` asks the operating system for a free port, which is what the tests use.
- `serveHost` provides its own journal and its own scope. A caller gets a URL and a running kernel, and releasing the scope stops both.
- SIGINT and SIGTERM resolve into a scope close, so the kernel deactivates the pi bridge and the bridge stops its children. Without it, a Ctrl-C orphans them. An open stream makes that close wait up to the platform's twenty-second preemptive shutdown.
- `harness-pi` now reads a file at module load, so the package is node-only in a way it always was in fact. Its `@oru/harness-pi/testing` subpath exports the scripted provider, which is what lets the host's end-to-end test run hermetically and what `apps/host` depends on to prove a real pi turn.
- The browser bundle drops from 554.47 kB to 520.01 kB (175.75 to 165.42 kB gzip), because the app no longer carries the kernel, the plugin set, or effect-uai.
- The app's transport target is `VITE_ORU_HOST_URL`, empty by default, which means its own origin. `vite.config.ts` forwards `/rpc` to the host's default port in development, so `pnpm dev` runs both and the browser crosses no origin boundary.
- The view's panel set is only as fresh as the graph stream. `WatchGraph` emits its snapshot before it subscribes to the host's events, so an activation in that window is not delivered until the next one. The window was in-process before; the transport widens it, and closing it is a change to the handler rather than to the transport.
- HTTP costs one connection per open stream, and a thread pane holds three, against the six a browser allows per origin. A WebSocket transport multiplexes them onto one. Its socket tracking and resync marker are the price.
- Whether a streamed response arrives progressively depends on what sits between the browser and the host. Vite's dev proxy passes chunks through as they are written; a proxy that buffers a response body collapses the stream into one late chunk, and a WebSocket upgrade is not a response body, so it cannot. The first was measured here, the second by a design probe that this repository's tests do not cover.
