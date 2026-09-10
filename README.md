# oru

oru is an agent control plane: a kernel of composable plugins that runs on effect-uai for the model-facing agent loop, and owns its own tools, sessions, and UI. Everything is a plugin. For the view, everything is a submodel.

Status: design. No implementation yet.

## Docs

- [CONTEXT.md](./CONTEXT.md) — the domain glossary.
- [docs/adr](./docs/adr) — architecture decision records.
- [PLAN.md](./PLAN.md) — ephemeral build plan; deleted once the initial slice ships.

## Decisions

| # | Decision |
| --- | --- |
| [0001](./docs/adr/0001-effect-native-kernel.md) | Effect-native kernel; no chord or cordis dependency |
| [0002](./docs/adr/0002-plugin-facets.md) | A plugin unifies runtime and UI as facets |
| [0003](./docs/adr/0003-effect-uai-runtime.md) | The inference runtime is a plugin built on effect-uai |
| [0004](./docs/adr/0004-hybrid-activation.md) | Hybrid activation: static graph at boot, reactive coeffects at runtime |
| [0005](./docs/adr/0005-monorepo-unpublished.md) | pnpm monorepo: `@oru/kernel` + `oru` |
| [0006](./docs/adr/0006-plugin-declarations.md) | Plugin declarations are data; setup wires behavior |
| [0007](./docs/adr/0007-session-log.md) | The session is an immutable event log; runtime state is a projection |
| [0008](./docs/adr/0008-presentation-rpc.md) | The presentation facet talks to the server over typed RPC |
| [0009](./docs/adr/0009-plugin-scope.md) | Plugin scope: host-global and per-thread |
| [0010](./docs/adr/0010-view-mirrors-active-graph.md) | The view tree mirrors the active plugin graph |
| [0011](./docs/adr/0011-facet-reload.md) | Facets reload as content-addressed bundle generations |
| [0012](./docs/adr/0012-session-journal.md) | Session events persist through the Effect event journal |

## Stack

TypeScript on Effect v4 (`4.0.0-rc.112`), Foldkit for the view, effect-uai for the model and tool layer, Tardigrade's log-driven component model as prior art.
