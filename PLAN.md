# oru build plan

> A working plan, not a source of truth. Decisions live in `docs/adr/` and vocabulary in `CONTEXT.md`.

## Goal

Reach the initial slice: a running host where two plugins activate and deactivate as their coeffects appear and disappear, the view mirrors the live plugin graph, and the session journal records every transition — with no model involved. Everything after stacks on this.

## Stack

- pnpm workspace, TypeScript.
- `effect` pinned. Foldkit and effect-uai both track it, so add a version-canary check.
- `foldkit` + `@foldkit/ui` for the presentation facet.
- `@effect-uai/core` for the runtime (unit 6).
- `effect/unstable/rpc` for the presentation seam.
- `effect/unstable/eventlog` + `@effect/sql-sqlite-node` for the session journal.
- oxlint, prettier, vitest.

## Packages

- `packages/kernel` — `@oru/kernel`: contexts, service tokens, activation, contributions, session log, facet loader, plugin declaration.
- `apps/oru` — the host and Foldkit app.
- `plugins/*` — fixture plugins for tests and the slice.

## Units

Each unit ends in a verifiable state. Do not start the next until the current one is checked.

1. **Workspace + kernel core.** pnpm workspace, tsconfig, lint. Service tokens, context, `definePlugin({ needs, provides, server?, ui? })`, contribution kinds. Static boot resolution: providers before consumers; a consumer with unmet coeffects stays inactive. Contributions reverse on `Scope`. Verify: a test activates and deactivates a plugin and asserts contributions appear and are reversed.
2. **Session journal.** `SessionLog` over `EventJournal`'s memory layer: `write`, `entries`, `changes`. Activation and deactivation append events. Verify: a test appends events and reprojects.
3. **Reactive activation.** Watch the service registry; adding or removing a provider activates or deactivates dependents. Verify: a provider/consumer pair flips live, and the journal records each transition.
4. **Presentation facet.** `effect/unstable/rpc` boundary; a Foldkit root submodel holding a keyed collection of plugin submodels; activation adds, deactivation removes. Spike the dynamic keyed collection first — it is the least-proven Foldkit pattern. Verify: in a browser, toggling the provider makes the consumer's panel appear and disappear.
5. **Facet loader.** `FacetLoader` seam; a content-addressed bundle per generation; load candidate, validate, cut over, dispose old in reverse order; stable facades across cutover. Verify: reload a fixture plugin and assert its new behavior is live and the old contributions are gone.
6. **Runtime.** Inference plugin on `@effect-uai/core` (`LanguageModel`, `Tool`, `Toolkit`), tools as contributions, Thread/Session plumbing, stream to the panel. Verify: send a message and watch a turn and a tool call appear in the journal and the view.

## Risks and spikes

- **Foldkit dynamic submodel collection** (unit 4): prototype before relying on it.
- **Effect v4 lockstep pins** (all units): a canary test asserts one `effect` version across kernel, Foldkit, and effect-uai.
- **`effect/unstable/*` churn** (units 2, 4): pin, and isolate behind `SessionLog` and the RPC boundary.
- **Standard Schema at the Tool boundary** (unit 6): confirm effect-uai accepts Effect Schema.

## Verification

- `pnpm -r typecheck`, `pnpm -r test`.
- Each unit ships a test that drives it the way the app does.
- Browser check with the agent-browser skill once the presentation facet exists.
