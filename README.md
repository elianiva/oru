# oru

oru is an agent control plane: a kernel of composable plugins that runs on effect-uai for the model-facing agent loop, and owns its own tools, sessions, and UI. Everything is a plugin. For the view, everything is a submodel.

Status: active development.

## Docs

- [CONTEXT.md](./CONTEXT.md) — the domain glossary.
- [docs/adr](./docs/adr) — architecture decision records.
- [PLAN.md](./PLAN.md) — build plan.

## Decisions

| #                                                    | Decision                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| [0001](./docs/adr/0001-effect-native-kernel.md)      | Effect-native kernel; no chord or cordis dependency                    |
| [0002](./docs/adr/0002-plugin-facets.md)             | A plugin unifies runtime and UI as facets                              |
| [0003](./docs/adr/0003-effect-uai-runtime.md)        | The inference runtime is a plugin built on effect-uai                  |
| [0004](./docs/adr/0004-hybrid-activation.md)         | Hybrid activation: static graph at boot, reactive coeffects at runtime |
| [0005](./docs/adr/0005-monorepo-unpublished.md)      | pnpm monorepo: `@oru/kernel` + `oru`                                   |
| [0006](./docs/adr/0006-plugin-declarations.md)       | Plugin declarations are data; setup wires behavior                     |
| [0007](./docs/adr/0007-session-log.md)               | The session is an immutable event log; runtime state is a projection   |
| [0008](./docs/adr/0008-presentation-rpc.md)          | The presentation facet talks to the server over typed RPC              |
| [0009](./docs/adr/0009-plugin-scope.md)              | Plugin scope: host-global and per-thread                               |
| [0010](./docs/adr/0010-view-mirrors-active-graph.md) | The view tree mirrors the active plugin graph                          |
| [0011](./docs/adr/0011-facet-reload.md)              | Facets reload as content-addressed bundle generations                  |
| [0012](./docs/adr/0012-session-journal.md)           | Session events persist through the Effect event journal                |
| [0013](./docs/adr/0013-session-tree.md)              | Session events form a pi-style tree per lane                           |
| [0014](./docs/adr/0014-model-plugin.md)              | The model is a plugin, not a host Layer                                |
| [0015](./docs/adr/0015-tool-contributions.md)        | Tool contributions are JSON, not effect-uai Tool values                |
| [0016](./docs/adr/0016-inference-token-view.md)      | Chat follows the Inference token, not a plugin id                      |
| [0017](./docs/adr/0017-harness-registry.md)          | Many harnesses on one host; a thread picks one                         |
| [0018](./docs/adr/0018-harness-session-authority.md) | A harness may own its conversation; history is bootstrap material      |
| [0019](./docs/adr/0019-thread-configuration.md)      | Thread configuration is harness, model, thinking level                 |
| [0020](./docs/adr/0020-harness-event-surface.md)     | Harness events carry session facts, and the runtime records them       |
| [0021](./docs/adr/0021-pi-bridge-subprocess.md)      | The pi harness is a subprocess bridge with an injected extension       |
| [0022](./docs/adr/0022-pi-tool-bridging.md)          | oru's tools become pi tools; pi keeps its own                          |
| [0023](./docs/adr/0023-pi-maintenance.md)            | pi maintenance is reported, not performed                              |

## Stack

TypeScript on Effect v4, Foldkit for the view, effect-uai for the model and tool layer, Tardigrade's log-driven component model as prior art.

## Verifying

```
pnpm lint && pnpm fmt:check && pnpm -r typecheck && pnpm test
```

`pnpm test` is hermetic: the pi bridge runs against a scripted pi, models are scripted, no account is touched.

To run the whole stack against the pi that is installed on this machine and signed in to a real provider — a real process, a real model, a real tool call, and the facts oru records from it:

```
ORU_PI_E2E_MODEL=<provider>/<model> pnpm --filter @oru/harness-pi e2e
```

`pi --list-models` names the candidates. The test skips without one, because only you know which account to spend. `apps/oru` is a browser app and cannot spawn pi, so the end-to-end host is this test; `plugins/harness-pi/src/index.ts` is the bridge it drives.
