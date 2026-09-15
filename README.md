# oru

oru is an agent control plane: a kernel of composable plugins that runs on effect-uai for the model-facing agent loop, and owns its own tools, sessions, and UI. Everything is a plugin. For the view, everything is a submodel.

Status: active development.

## Docs

- [CONTEXT.md](./CONTEXT.md) — the domain glossary.
- [docs/adr](./docs/adr) — architecture decision records.
- [docs/configuration.md](./docs/configuration.md) — host settings, precedence, and keys.
- [PLAN.md](./PLAN.md) — build plan.
- [CONTRIBUTING.md](./CONTRIBUTING.md) — setup and the gate a change must pass.
- [docs/release.md](./docs/release.md) — how to bump, pack, and cut a release.
- [docs/qa/debug-and-qa.md](./docs/qa/debug-and-qa.md) — reproduce a host failure, a pi bridge failure, and a stuck turn.
- [docs/qa/missed-invariants.md](./docs/qa/missed-invariants.md) — escaped bugs and the guards that catch them.
- [CHANGELOG.md](./CHANGELOG.md) — notable changes.
- [LICENSE](./LICENSE) — MIT.

## Decisions

| #                                                     | Decision                                                                      |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| [0001](./docs/adr/0001-kernel-composition.md)         | Effect-native kernel, data-shaped declarations, generation reload             |
| [0002](./docs/adr/0002-plugin-facets-and-scope.md)    | A plugin is one identity with facets, activated host-wide or per thread       |
| [0003](./docs/adr/0003-session-log.md)                | The session is an immutable event log, projected as state, stored as a tree   |
| [0004](./docs/adr/0004-presentation-seam.md)          | Typed RPC to the server; the view mirrors the active graph                    |
| [0005](./docs/adr/0005-inference-runtime.md)          | Inference is an ordinary plugin: effect-uai, model as plugin, tools as JSON   |
| [0006](./docs/adr/0006-harness-layer.md)              | Many harnesses on one host: registry, session ownership, thread configuration |
| [0007](./docs/adr/0007-pi-bridge.md)                  | The pi harness is a subprocess bridge: protocol, tools, reported maintenance  |
| [0008](./docs/adr/0008-monorepo-unpublished.md)       | pnpm monorepo: `@oru/kernel` + `oru`, unpublished                             |
| [0009](./docs/adr/0009-node-host-and-transport.md)    | A node host process serves the kernel over HTTP, and the app is its client    |
| [0010](./docs/adr/0010-durable-sessions.md)           | Durable sessions in the host: the log is opened, resumed, and reprojected     |
| [0011](./docs/adr/0011-mit-license-and-agent-docs.md) | MIT license; no AGENTS.md                                                     |
| [0012](./docs/adr/0012-config-precedence.md)          | Effect Config, one file, flags then file then env then defaults               |

## Stack

TypeScript on Effect v4, Foldkit for the view, effect-uai for the model and tool layer, Tardigrade's log-driven component model as prior art.

## Running

`apps/host` is the process. It composes the kernel, serves `HostRpc` and `ThreadRpc` on loopback, and carries the one plugin a browser cannot: `oru/harness-pi` spawns `pi`.

```
pnpm --filter @oru/host start          # http://127.0.0.1:7317
pnpm --filter @oru/host start -- --help
pnpm --filter @oru/host start -- config list
pnpm pack:host                         # tarball of the built host
pnpm pack:smoke                        # install that tarball, --version, start, stop
pnpm dev                               # the host and the browser app together
```

Settings are flags, then `~/.oru/config.json`, then `ORU_*` / `ORU_PI_*` environment variables, then built-in defaults. The file is created with mode `0600`. The listen address is loopback until you set `host`. Details are in [docs/configuration.md](./docs/configuration.md).

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

## Browser check

Unit tests assert the view tree; only a browser shows the composed app, and the app is a client of a running host, so start both:

```
pnpm dev
```

Open the printed URL and check these, in order. The picker defaults to `Oru (effect-uai)` with `Demo (mock)`, whose script is what the turn steps below rely on.

1. The rail lists one row per plugin that carries a panel (`Log`, `Greet`), and the info pane lists the services the host provides (`oru/logger`, `oru/harnesses`, `oru/inference`, `oru/greeter`).
2. Click `Turn logging off`. `Log`, `Greet`, `oru/logger`, and `oru/greeter` all disappear, because `greeter` is a consumer of `Logger`.
3. Click `Turn logging on`. All four come back.
4. Type a message into the pane and click `Send`. The transcript shows `user: ...`, `turn/started`, `tool/requested echo`, `tool/completed echo`, and `assistant: done`, with no leftover live lines from the stream.
5. Send a second message. The demo model scripts two turns, so the next turn fails and the transcript shows a `turn/failed ...` line.
6. Click `New thread`. The transcript empties and the pane starts a fresh thread.

CI runs steps 2 and 4 in a real Chromium through Playwright (`pnpm --filter ./apps/oru e2e`). A failure keeps a screenshot and the last 8000 bytes of `apps/oru/test-results/host.log`.

`docs/evidence/issue-11` holds the screenshots from one run of these steps, taken with the agent-browser CLI:

```
agent-browser open <url>
agent-browser snapshot -i
agent-browser click @e13
agent-browser screenshot shot.png
```

## License

oru is MIT. See [LICENSE](./LICENSE).
