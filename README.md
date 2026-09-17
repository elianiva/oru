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
- [CHANGELOG.md](./CHANGELOG.md) — notable changes.
- [LICENSE](./LICENSE) — MIT.

## Decisions

| #                                                      | Decision                                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| [0001](./docs/adr/0001-kernel-composition.md)          | Effect-native kernel, data-shaped declarations, generation reload             |
| [0002](./docs/adr/0002-plugin-facets-and-scope.md)     | A plugin is one identity with facets, activated host-wide or per thread       |
| [0003](./docs/adr/0003-session-log.md)                 | The session is an immutable event log, projected as state, stored as a tree   |
| [0004](./docs/adr/0004-presentation-seam.md)           | Typed RPC to the server; the view mirrors the active graph                    |
| [0005](./docs/adr/0005-inference-runtime.md)           | Inference is an ordinary plugin: effect-uai, model as plugin, tools as JSON   |
| [0006](./docs/adr/0006-harness-layer.md)               | Many harnesses on one host: registry, session ownership, thread configuration |
| [0007](./docs/adr/0007-pi-bridge.md)                   | The pi harness is a subprocess bridge: protocol, tools, reported maintenance  |
| [0008](./docs/adr/0008-monorepo-unpublished.md)        | pnpm monorepo: `@oru/kernel` + `oru`, unpublished                             |
| [0009](./docs/adr/0009-node-host-and-transport.md)     | A node host process serves the kernel over HTTP, and the app is its client    |
| [0010](./docs/adr/0010-durable-sessions.md)            | Durable sessions in the host: the log is opened, resumed, and reprojected     |
| [0011](./docs/adr/0011-mit-license-and-agent-docs.md)  | MIT license; no AGENTS.md                                                     |
| [0012](./docs/adr/0012-config-precedence.md)           | Effect Config, one file, flags then file then env then defaults               |
| [0013](./docs/adr/0013-host-unreachable-is-a-state.md) | A host that does not answer is a rendered state, not a defect                 |
| [0014](./docs/adr/0014-project-edits-are-facts.md)     | A project edit is a fact carrying the whole project                           |
| [0015](./docs/adr/0015-composer-chip-panels.md)        | The composer's chip carries a panel owned by its contributor                  |
| [0016](./docs/adr/0016-harness-is-a-fact.md)           | The harness is a host fact; the model picker is a list                        |
| [0017](./docs/adr/0017-composer-slot-pickers.md)       | The composer is a box with slots; pickers are submodels                       |
| [0018](./docs/adr/0018-provider-metadata-and-tabs.md)  | Harness plugins name providers; the picker tabs by them                       |

## Development

### Prerequisites

Node 26 or newer, and the pnpm pinned in the root `package.json` `packageManager` field (`corepack enable` gets you that pnpm). Then:

```
pnpm install
```

`pnpm install` also runs `lefthook install` via the `prepare` script, so the pre-commit (format, lint) and pre-push (typecheck, test) hooks are active. CI installs with `pnpm install --frozen-lockfile` on Node 26.

Optional, only for the live model test: the `pi` binary on `PATH` and a signed-in account. Everything else is hermetic — the pi bridge runs against a scripted pi and models are scripted, so no account is touched by default.

### Layout

```
apps/host        # the process: composes the kernel, serves HostRpc/ThreadRpc on loopback, owns harness-pi
apps/oru         # the browser client of a running host (Foldkit view)
packages/kernel  # @oru/kernel: contexts, services, activation, contributions
packages/rpc     # @oru/rpc: RPC groups, wire schemas, client facades, route paths
packages/harness # shared harness seams
packages/plugin-build # facet bundling via oru-build-facet (esbuild)
plugins/*        # harness-oru, harness-pi, harness-registry, inference
scripts/         # bump-version, version lockstep, pack-host, pack-smoke
turbo.json       # typecheck / test / build / dev / e2e task graph
pnpm-workspace.yaml # workspace globs (packages/*, plugins/*, apps/*)
```

Decisions live in [docs/adr](./docs/adr) and vocabulary in [CONTEXT.md](./CONTEXT.md).

### Stack

TypeScript on Effect v4, Foldkit for the view, effect-uai for the model and tool layer, Tardigrade's log-driven component model as prior art.

### Running

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

### Verifying

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

### Browser check

Unit tests assert the view tree; only a browser shows the composed app, and the app is a client of a running host, so start both:

```
pnpm dev
```

Open the printed URL and check these, in order.

1. The middle column lists the host's projects under the composer, or says `No projects yet` — an empty state, not an empty list.
2. Three columns: the thread list on the left, the composer in the middle, `Details` on the right.
3. Drag the seam between the thread list and the composer. The list widens, the middle column narrows by the same amount, and `Details` keeps its width.
4. Click the panel icon on the left of the header. The thread list closes and the middle column takes the room. Click it again. The list reopens at the width it had.
5. Click the panel icon on the right of the header, then reload the page. `Details` stays closed and every other width comes back.
6. Open `/thread/<id>`. The middle column is the conversation rather than the hero composer. Reload: you are in the same thread. Go back: the hero composer returns. (Thread rows arrive from the host's thread integration; an empty host lists none.)
7. Collapse a thread section from its header. The shelf closes and its header keeps the row count.
8. Type a message in the composer and click the send button. The box clears and the send button returns to disabled.
9. Stop the host and reload. The app says `Host unreachable` with the reason and a `Retry`, and no column pretends to hold a fact. Start the host again and click `Retry`: the app comes back.

Sidebar widths are percentages of the window, so every column grows when you widen the window. A sidebar stops at its own minimum and maximum at a 1440px window.

CI runs these steps in a real Chromium through Playwright (`pnpm --filter ./apps/oru e2e`), driven by `apps/oru/e2e/browser.spec.ts`. A failure keeps a screenshot and the last 8000 bytes of `apps/oru/test-results/host.log`.

The suite starts its own host on a port the kernel picks and its own dev server, so it runs beside a `pnpm dev`: set `ORU_E2E_PORT` to move the dev server off 5173. `ORU_PROXY_TARGET` points a dev server at a host somewhere else, which is what the suite uses to follow the host it started.

### Conventions

- Use [CONTEXT.md](./CONTEXT.md) vocabulary in new code and docs.
- Record architecture choices in [docs/adr](./docs/adr).
- How to bump the host and pack a tarball is in [docs/release.md](./docs/release.md).
- How to reproduce a host failure, a pi bridge failure, and a stuck turn is in [docs/qa/debug-and-qa.md](./docs/qa/debug-and-qa.md).
- The full gate a change must pass, including the browser job CI runs on pull requests, is in [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

oru is MIT. See [LICENSE](./LICENSE).
