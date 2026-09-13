# The inference runtime is a plugin built on effect-uai

The model and tool layer uses `@effect-uai/core` (`LanguageModel`, `Tool`, `Toolkit`) to stream turns and execute tools. The inference runtime itself is an ordinary plugin: its server facet folds the session log, derives inference work, executes it, and appends the results. Swapping the runtime means swapping that plugin, the same boundary every plugin uses, so there is no separate runtime seam.

## Considered Options

- **Wrap pi-agent-core's `Agent`**: coding-agent maturity and coding-specific affordances such as steering and follow-up modes, but TypeBox schemas, a non-Effect runtime, and a chord-based composition layer underneath.
- **Own model loop on `pi-ai`**: full control, but reinvents streaming, tool execution, and typed errors that effect-uai provides.
- **effect-uai primitives inside a plugin** (chosen): Effect-native streaming and tools, with continuation expressed as facet reconciliation over the log rather than a separate loop primitive.
- **A dedicated `AgentRuntime` service**: an extra indirection that duplicates the plugin boundary.

## Consequences

- Tool parameters use Standard Schema (Effect Schema canonical); no TypeBox.
- effect-uai and Foldkit pin Effect versions, so the stack moves in lockstep. A version-canary check guards this.
- effect-uai is early (0.x, few dependents). Only its provider primitives are used, so it stays vendor-able.
- effect-uai's `Loop` primitive is unused; continuation is the facet's own reconciliation over the log.
- Coding-agent affordances such as steering and follow-up queue modes are oru's to own as plugins.
