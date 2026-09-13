# Kernel — Unit 1 (`@oru/kernel`)

Synthesized design from architect Phase B. Runners: A (Opus) and C (DeepSeek V4 Pro);
B (Qwen) was stopped before producing a package. Shapes are implemented in
[`packages/kernel/src`](../../packages/kernel/src); this file is the rationale.

## Problem

`@oru/kernel` is the composition runtime every later unit stacks on. It must let a plugin author
declare coeffects (`needs`) and contributions (`provides`) as **data** (ADR-0006) while wiring
behavior as ordinary Effect code; resolve a provider-before-consumer graph at boot and reactively at
runtime through **one** mechanism (ADR-0004); reverse every contribution on deactivation by closing
an Effect `Scope`; and leave three seams in the right place — an observable registry (Unit 3), a
provider indirection whose captured handles survive a facet cutover (Unit 5, ADR-0011), and open
contribution kinds for tools and submodels (Unit 6). The shape is non-obvious because Unit 1 is
static yet its types must already carry those later loads, and because the domain word **Context**
collides with Effect's `Context` while Effect v4 renamed the old `Context.Tag`/`GenericTag` to
`Context.Service`.

## Usage (caller's view)

A plugin author imports `defineService`, `definePlugin`, and `defineContributionKind`. Tokens are
`Context.Service` values; `needs`/`provides` are data. A service is contributed by listing its token;
a data payload is contributed by calling the kind that owns it.

```ts
import { Context, Effect } from 'effect'
import { defineContributionKind, defineService, definePlugin } from '@oru/kernel'

interface LoggerService {
  readonly log: (message: string) => Effect.Effect<void>
}
const Logger = defineService<LoggerService>('oru/logger')

interface ToolSpec {
  readonly name: string
}
const ToolKind = defineContributionKind<ToolSpec>('oru/tool')

export const loggingPlugin = definePlugin({
  id: 'logging',
  provides: [Logger],
  server: {
    setup: () => Effect.succeed(Context.make(Logger, { log: (m) => Effect.log(m) })),
  },
})

export const echoToolPlugin = definePlugin({
  id: 'echo-tool',
  provides: [ToolKind.of({ name: 'echo' })],
})

export const greeterPlugin = definePlugin({
  id: 'greeter',
  needs: [Logger],
  server: {
    setup: (ctx) => {
      const logger = ctx.service(Logger) // stable facade, synchronous handle
      return Effect.void
    },
  },
})
```

Boot and drive the host — this is also the Unit 1 verification:

```ts
const host = yield * makeHost([greeterPlugin, loggingPlugin]) // order shuffled on purpose
const graph = yield * host.graph
graph.active.has('logging') // provider activated before consumer
yield * host.deactivate('logging')
;(yield * host.graph).active.has('greeter') // false — dependents reverse first
```

## Shape

### Module map

```
packages/kernel/src/
  index.ts         public re-exports only
  primitives.ts    PluginId, TokenId, ThreadId, PluginScope schemas
  service.ts       ServiceToken (Context.Service), defineService, serviceId
  contribution.ts  ContributionKind, DataContribution, serviceTokensOf, dataContributionsOf
  plugin.ts        Plugin, PluginContext, ServerFacet, definePlugin, AnyPlugin
  event.ts         HostEvent schema union, members derived with Schema.TaggedStruct
  errors.ts        schema-backed TaggedError classes, MismatchProblem union
  registry.ts      observable registry, per-token cells, makeFacade
  resolve.ts       pure resolve(): order + blocked, boot and reactive share it
  host.ts          makeHost, activate/deactivate, Activation/Graph schemas, store
```

### Load-bearing decisions

- **Schema-first data; types derive.** Every domain data type — ids and scope in `primitives.ts`,
  events in `event.ts`, errors in `errors.ts`, and `Activation`/`Graph` — is defined as an Effect
  `Schema`, with the TypeScript type derived via `Schema.Schema.Type<typeof X>`. Tagged values are
  built with `Schema.make` (`.make({...})`) or `new` for `Schema.TaggedError` classes, so a value can
  never drift from its schema. This is what lets `HostEvent = Schema.Union([...])` compose and feed
  the journal (ADR-0007) and RPC seam (ADR-0008) without a parallel hand-written type.
- **Tokens are `Context.Service<S, S>` plus a stable string `.key`.** No `Tag`/`GenericTag` in
  Effect v4. `defineService` keeps both parameters precise — `Service<any, S>` would erase the
  identifier and silently accept any requirement, which is the type the coeffect check below depends
  on. The registry is keyed by the **string**, never object identity, which is what lets a
  reloaded bundle (fresh token objects, same ids) keep provider continuity (ADR-0011).
- **Contributions are a token or tagged schema data.** `provides` mixes two things: a service token,
  whose value is the `Context` the setup returns, and a `DataContribution` — tagged schema data the
  kernel stores and reverses by kind id without interpreting. Only the kind owns the payload type,
  so `ToolKind.of(spec)` is the only way to build one and a payload can never be paired with a kind
  it does not belong to. A token is a live `Context.Service`, not schema-able data, so it goes in as
  itself.
- **`setup` returns an Effect `Context`, and `needs` are its requirement channel.** `setup` has type
  `(ctx) => Effect<Context<ServiceProvisions<Provides>>, E, IdentifierOf<Needs[number]> | Scope>`.
  The requirement channel `R` rejects an undeclared coeffect, and `Context<Services>` is
  contravariant, so a setup that omits a declared service or substitutes another one does not
  type-check either. Types cannot see a _returned_ service the declaration never claimed — a
  superset still satisfies the declaration — so that direction, plus every facet whose types were
  erased, is caught at activation by the `Context.getOption` / key-diff check (ADR-0006).
- **One pure `resolve`**, shared by boot and the future watcher: Kahn's fixpoint over
  `needs`/`provides`, returning an activation order plus a `blocked` map. Unmet coeffects are graph
  state, not a hard error (ADR-0004, ADR-0010).
- **Reversal is the scope.** Each plugin forks a child `Scope`; every contribution registers a
  finalizer on it, so `deactivate` is `Scope.close` and reversal is LIFO and idempotent by
  construction.
- **Facades are stable.** `ctx.service(token)` and the ambient `yield* Token` path both return a
  `Proxy` that resolves the current implementation at call time through the string-keyed registry, so
  a handle captured before a cutover keeps working (ADR-0011). Non-method members are rejected at
  activation.
- **Contribution kinds are open.** The kernel stores, exposes, and reverses typed payloads by kind id
  without interpreting them; tools and submodels land as new kinds owned by their own packages.

Invariants in types: declared-coeffect access (`Needs[number]`), setup/declaration shape
(`ServiceProvisions<Provides>`), provider-before-consumer order (computed, not emergent). Validation
lives at `definePlugin`/`resolve` (structural) and at activation (declaration drift), per
boundary-discipline. `test/typetest/*.tst.ts` pins the type-level half — an omitted or substituted
service, an undeclared coeffect, and the `ServiceProvisions` derivation itself; `tsc` compiles those
files and vitest does not run them, so a directive that stops being an error fails `pnpm typecheck`.

## Synthesis decision

Base: **C** (string-keyed registry, one serialized transition path, `HostEvent` stream, open
contribution kinds, thread flattening encoded in types) — it already carried the Unit 2/3/5/6 seams,
so it needed no redesign. Grafted from **A**: `setup` returns an Effect `Context` with `needs` as its
requirement channel, which is the more idiomatic Effect wiring and gives the compile-time
declaration/behavior check. Rejected from both: a semaphore in Unit 1 (no concurrency yet — defer to
Unit 3), `GraphCycle` as a boot abort for managed deadlocks (kept, but it is a structural error, not a
blocked state), and provider-absence as a typed facade error (it is a defect: the graph's
dependents-before-providers teardown makes it unreachable in kernel-managed flows).

## Tradeoffs accepted

- We accept method-only service contracts in exchange for type-transparent provider replacement with
  no proxy cost visible at call sites.
- We accept keying by string id with duplicate-provider detection in exchange for handle continuity
  across facet generations.
- We accept re-deriving the whole plan on each registry change instead of an incremental graph in
  exchange for one boot/reactive resolution mechanism and trivially idempotent transitions.
- We accept declaration/setup agreement checked in the type system where it is provable (an
  undeclared coeffect on `R`, a missing or substituted service on `Context<Services>`) and at
  activation otherwise (a service returned but never declared, and facets loaded with erased types).
  A `Context` is only ever checked to _contain_ its declaration, exactly as Effect's `Layer<in ROut>`
  works; the kernel cannot publish on a type it cannot see, so it rejects the extra key instead.
- We accept `Effect<..., unknown, ...>` setup errors wrapped into `SetupFailed` at the seam in
  exchange for not constraining what plugin authors may fail with.

## Alternatives considered

- **Setup-call declarations (cordis-style `ctx.use`/`ctx.provide`).** Rejected by ADR-0006: the graph
  would exist only after running effectful code, so the watcher must execute plugins to diff them and
  the view cannot render a not-yet-active graph.
- **Direct `Tag` binding with no registry indirection.** Smaller types, but a handle captured before a
  cutover dies with its generation, violating ADR-0011; retrofitting the indirection breaks every
  consumer.
- **Plugins as Effect `Layer`s.** A Layer graph is fixed at construction; unmet-coeffect-as-state and
  runtime activation/deactivation have no Layer representation. Layers remain the host-assembly
  mechanism, not the plugin mechanism.

## Open questions and risks

- `Context.Service` and `Scope.fork`/`Scope.provide` are `rc.112` shapes; a version-canary test must
  pin one `effect` across kernel, Foldkit, and effect-uai (PLAN).
- Provider replacement policy: is a runtime add/remove (Unit 3) always a cell swap, or must
  uncoordinated replacement deactivate dependents first?
- `SetupEnv` flows plugin setup requirements into `makeHost`'s `R` at the typed host; Unit 5's
  dynamically loaded bundles erase that to `unknown` — acceptable?
- Should thread-scoped plugins declared at boot appear as their own graph state, or is `blocked`
  misleading for them?
- `Effect<..., unknown, ...>` setup errors are wrapped to `SetupFailed`; if a plugin wants typed
  activation errors, the facet contract must carry them generically.

## Next implementation step

Unit 2: the `SessionLog` service over `effect/unstable/eventlog`, subscribing to `host.events` and
appending `plugin/activated` / `plugin/deactivated`, then a projection test that reprojects the log.
