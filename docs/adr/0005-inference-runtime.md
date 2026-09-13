# Inference is an ordinary plugin: effect-uai provider, model as plugin, tools as JSON

The model and tool layer uses `@effect-uai/core` (`LanguageModel`, `Tool`, `Toolkit`) to stream turns and execute tools. The inference runtime itself is an ordinary plugin: its server facet folds the session log, derives inference work, executes it, and appends the results. Continuation is the facet's own reconciliation over the log, and effect-uai's `Loop` primitive is unused. Swapping the runtime means swapping that plugin, the same boundary every plugin uses, so there is no separate runtime seam.

The `LanguageModel` service is contributed by a model plugin (`oru/model-demo` in the slice) and listed by the inference plugin in `needs`. The host process does not `Effect.provide` a model Layer onto the program fiber. Tool contributions are JSON: `ToolKind` (`oru/tool`) carries name, description, an Effect Schema, and `runJson`, and the inference plugin maps contributions to effect-uai tools inside `seam.ts` when it calls the model. In the view, the Foldkit root opens the chat pane when `ViewGraph.tokens` contains `Inference.key` rather than checking a plugin id.

## Considered options

- **Wrap pi-agent-core's `Agent`**: coding-agent maturity and affordances such as steering and follow-up modes, but TypeBox schemas, a non-Effect runtime, and a chord-based composition layer underneath.
- **Own model loop on `pi-ai`**: full control, but reinvents streaming, tool execution, and typed errors that effect-uai provides.
- **effect-uai primitives inside a plugin** (chosen): Effect-native streaming and tools, with continuation as facet reconciliation.
- **A dedicated `AgentRuntime` service**: an extra indirection that duplicates the plugin boundary.
- **Fiber Layer** (previous): a `demoModelLayer` on `apps/oru` and every test. Inference declared `needs: []` and safety-cast its setup so it could `yield* LanguageModel`. The graph could not block or deactivate inference when the model was absent.
- **Kernel-owned Model token**: an oru wrapper in `@oru/kernel`, which would import or duplicate the effect-uai service shape.
- **Model plugin providing `LanguageModel`** (chosen): the same `definePlugin` path as every other service (`provides: [LanguageModel]`). Inference stays blocked until a model plugin is active. A later engine that does not use effect-uai simply does not need this token.
- **Store `Tool.AnyLocalTool` on the contribution** (previous): tool plugins import effect-uai types through `@oru/inference`, and a Pi or ACP engine cannot read that payload.
- **Kernel-owned tool kind**: tool plugins would import only `@oru/kernel`, but the kernel would own a tools vocabulary that design 0001 leaves to packages.
- **JSON `runJson` on an inference-owned kind** (chosen): tool plugins depend on `@oru/inference` for the kind, not for `Tool`, and a later engine can ignore `ToolKind` or read the same JSON contract.
- **Key the pane on `inferencePlugin.id`**: breaks as soon as the engine plugin id is not `oru/inference`.
- **Key the pane on the `Inference` token** (chosen): the token is the RPC contract, and the plugin id is an implementation detail.

## Consequences

- Tool parameters use Standard Schema (Effect Schema canonical); no TypeBox.
- effect-uai and Foldkit pin Effect versions, so the stack moves in lockstep. A version-canary check guards this.
- effect-uai is early (0.x, few dependents). Only its provider primitives are used, so it stays vendor-able.
- Coding-agent affordances such as steering and follow-up queue modes are oru's to own as plugins.
- `makeHost([echo, inference])` leaves inference in `blocked` with the LanguageModel key missing. `deactivate` on the model plugin tears inference down through the existing dependent walk.
- Two plugins that both list `LanguageModel` in `provides` still fail `DuplicateProvider`. Swap the model with `host.replace` or deactivate-then-activate. The vendor key `@betalyra/effect-uai/LanguageModel` is the graph id until an oru wrapper is worth it.
- `defineTool` decodes arguments at the contribution boundary. `runTool` calls `runJson`; it does not call `Tool.execute`. `toolkitOf` is the only place that builds effect-uai `Tool.make` values.
- Host RPC copies live registry keys into `tokens`, `ViewGraph` carries `tokens` next to `active` panels, and the UI imports `Inference` rather than `inferencePlugin`. A replacement engine plugin can use another id as long as it lists `Inference` in `provides`.
