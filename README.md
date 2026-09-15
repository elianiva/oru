# oru

oru is an agent control plane: a kernel of composable plugins that runs on effect-uai for the model-facing agent loop, and owns its own tools, sessions, and UI. Everything is a plugin. For the view, everything is a submodel.

Status: active development.

## Docs

- [CONTEXT.md](./CONTEXT.md) — the domain glossary.
- [docs/adr](./docs/adr) — architecture decision records.
- [PLAN.md](./PLAN.md) — build plan.

## Decisions

| #                                                  | Decision                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| [0001](./docs/adr/0001-kernel-composition.md)      | Effect-native kernel, data-shaped declarations, generation reload             |
| [0002](./docs/adr/0002-plugin-facets-and-scope.md) | A plugin is one identity with facets, activated host-wide or per thread       |
| [0003](./docs/adr/0003-session-log.md)             | The session is an immutable event log, projected as state, stored as a tree   |
| [0004](./docs/adr/0004-presentation-seam.md)       | Typed RPC to the server; the view mirrors the active graph                    |
| [0005](./docs/adr/0005-inference-runtime.md)       | Inference is an ordinary plugin: effect-uai, model as plugin, tools as JSON   |
| [0006](./docs/adr/0006-harness-layer.md)           | Many harnesses on one host: registry, session ownership, thread configuration |
| [0007](./docs/adr/0007-pi-bridge.md)               | The pi harness is a subprocess bridge: protocol, tools, reported maintenance  |
| [0008](./docs/adr/0008-monorepo-unpublished.md)    | pnpm monorepo: `@oru/kernel` + `oru`, unpublished                             |
| [0009](./docs/adr/0009-node-host-and-transport.md) | A node host process serves the kernel over HTTP, and the app is its client    |

## Stack

TypeScript on Effect v4, Foldkit for the view, effect-uai for the model and tool layer, Tardigrade's log-driven component model as prior art.

## Running

`apps/host` is the process. It composes the kernel, serves `HostRpc` and `ThreadRpc` on loopback, and carries the one plugin a browser cannot: `oru/harness-pi` spawns `pi`.

```
pnpm --filter @oru/host start          # http://127.0.0.1:7317
pnpm --filter @oru/host start --help   # --help, --version, --host, --port
pnpm dev                               # the host and the browser app together
```

`apps/oru` is a client of a running host. It reads the host URL from `VITE_ORU_HOST_URL` and defaults to its own origin; in development the Vite dev server forwards `/rpc` to the host, so both are one command and one origin.

The seam between them is `packages/rpc` (`@oru/rpc`): the RPC groups, the wire schemas, the client facades, and the two route paths.

## Verifying

`typecheck` / `test` / `build` run through Turborepo (`turbo.json`):

```
pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test && pnpm build
```

`pnpm test` is hermetic: the pi bridge runs against a scripted pi, models are scripted, no account is touched. `apps/host/test/e2e.test.ts` starts the real binary, points it at a scripted model provider, and drives a whole pi turn through the transport.

To run that host against the pi installed on this machine and an account that is signed in — a real process, a real model, a real tool call, and the facts oru records from it:

```
ORU_PI_E2E_MODEL=<provider>/<model> pnpm --filter @oru/host test
```

`pi --list-models` names the candidates. The test skips without one, because only you know which account to spend. `plugins/harness-pi/src/index.ts` is the bridge it drives.
