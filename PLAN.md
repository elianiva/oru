# oru build plan

> A working plan, not a source of truth. Decisions live in `docs/adr/` and vocabulary in `CONTEXT.md`.

## Goal

Reach the initial slice: a running host where two plugins activate and deactivate as their inject appears and disappears, the view mirrors the live plugin graph, and the session journal records every transition — with no model involved. Everything after stacks on this.

## Stack

- pnpm workspace, TypeScript.
- `effect` pinned. Foldkit tracks it, so add a version-canary check.
- `foldkit` + `@foldkit/ui` for the presentation facet.
- `@oru/harness` for the runtime contract and the delta assembler (unit 6).
- `effect/unstable/rpc` for the presentation seam.
- `effect/unstable/eventlog` + `@effect/sql-sqlite-node` for the session journal.
- oxlint, prettier, vitest.

## Packages

- `packages/kernel` — `@oru/kernel`: contexts, service tokens, activation, contributions, session log, facet loader, plugin declaration.
- `apps/oru` — the host and Foldkit app.
- `plugins/*` — fixture plugins for tests and the slice.

## Units

Each unit ends in a verifiable state. Do not start the next until the current one is checked.

1. **Workspace + kernel core.** pnpm workspace, tsconfig, lint. Service tokens, context, `definePlugin({ inject, Config?, apply? })`, contribution kinds. Boot retries the inject-blocked set until it stops progressing; a consumer with unmet inject stays inactive. Contributions reverse on `Scope`. Verify: a test activates and deactivates a plugin and asserts contributions appear and are reversed.
2. **Session journal.** `SessionLog` over `EventJournal`'s memory layer: `write`, `entries`, `changes`. Activation and deactivation append events. Verify: a test appends events and reprojects.
3. **Reactive activation.** Watch the service registry; adding or removing a provider activates or deactivates dependents. Verify: a provider/consumer pair flips live, and the journal records each transition.
4. **Presentation facet.** `effect/unstable/rpc` boundary; a Foldkit root submodel holding a keyed collection of plugin submodels; activation adds, deactivation removes. Spike the dynamic keyed collection first — it is the least-proven Foldkit pattern. Verify: in a browser, toggling the provider makes the consumer's panel appear and disappear.
5. **Facet loader.** `FacetLoader` seam; a content-addressed bundle per generation; load candidate, validate, cut over, dispose old in reverse order; stable facades across cutover. Verify: reload a fixture plugin and assert its new behavior is live and the old contributions are gone.
6. **Runtime.** Host turn driver on `@oru/harness` (history items, delta grammar, `ToolKind` contributions), Thread/Session plumbing, stream to the panel. Harnesses implement turns; the pi bridge proves the seam. Verify: send a message and watch a turn and a tool call appear in the journal and the view.

## Risks and spikes

- **Foldkit dynamic submodel collection** (unit 4): prototype before relying on it.
- **Effect v4 lockstep pins** (all units): a canary test asserts one `effect` version across kernel and Foldkit.
- **`effect/unstable/*` churn** (units 2, 4): pin, and isolate behind `SessionLog` and the RPC boundary.
- **JSON Schema at the Tool boundary** (unit 6): the runtime hands JSON Schema draft-2020-12 to the harness; the bridge renders it into its provider's tool shape.

## Verification

- `pnpm -r typecheck`, `pnpm -r test`.
- Each unit ships a test that drives it the way the app does.
- Browser check with the agent-browser skill once the presentation facet exists (runbook: [README > Browser check](./README.md#browser-check)).
