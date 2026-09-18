# The runtime drives turns; harnesses implement them: oru deltas, tools as JSON

The model and tool layer speaks oru's own vocabulary, owned by `@oru/harness`: history items, a narrow delta grammar, and tool descriptors as JSON Schema draft-2020-12. The host's turn driver folds the session log, derives turn work, asks the active harness for deltas, and appends the facts. Continuation is the driver's own reconciliation over the log. A bridge parses its provider's traffic into deltas; the assembler owns every timeline invariant: id minting, turn and item lifecycle, ordering.

The driver is host code, provided as `oru/runtime`, not a published plugin. It depends on the harness _registry_, not on any one harness: whichever plugins contribute a `HarnessKind` are candidates, and each thread picks one through its own configuration. The host process does not provide a model layer onto the program fiber. Tool contributions are JSON: `ToolKind` (`oru/tool`) carries name, description, an Effect Schema, and `runJson`. At the turn boundary the driver renders contributions into JSON Schema descriptors and hands them to the harness with an `executeTool` callback, and the bridge executes oru tools only through that callback. In the view, the Foldkit root opens the chat pane when `ViewGraph.tokens` contains `Runtime.key` rather than checking a plugin id.

## Considered options

- **Wrap pi-agent-core's `Agent`**: coding-agent maturity and affordances such as steering and follow-up modes, but TypeBox schemas, a non-Effect runtime, and a chord-based composition layer underneath.
- **Own model loop on `pi-ai`**: full control, but reinvents streaming, tool execution, and typed errors a shared vocabulary provides.
- **Harness contract with a delta grammar** (chosen): Effect-native streaming and tools, with continuation as driver reconciliation and timeline invariants in one assembler.
- **A dedicated `AgentRuntime` service**: an extra indirection that duplicates the plugin boundary.
- **Model plugin providing a model token** (previous): the same `definePlugin` path as every other service. Dropped with the provider SDK: no token crosses the seam, only history, deltas, and JSON Schema.
- **Store a provider tool object on the contribution** (previous): tool plugins import provider types, and a bridge for another agent cannot read that payload.
- **Kernel-owned tool kind**: tool plugins would import only `@oru/kernel`, but the kernel would own a tools vocabulary that design 0001 leaves to packages.
- **JSON `runJson` on a harness-owned kind** (chosen): tool plugins depend on `@oru/harness` for the kind, and every bridge reads the same JSON contract.
- **Key the pane on a plugin id**: breaks as soon as the driver is not that plugin.
- **Key the pane on the `Runtime` token** (chosen): the token is the RPC contract, and the plugin id is an implementation detail.

## Consequences

- Tool parameters use Effect Schema at the contribution boundary and JSON Schema draft-2020-12 on the wire; no TypeBox in oru code.
- The Effect version moves with Foldkit. A version-canary check guards this.
- Coding-agent affordances such as steering and follow-up queue modes are oru's to own as host code and harness capabilities.
- A thread naming an unknown harness fails at its turn, not at boot. The registry answers from contributions on each call, so activating or deactivating a harness plugin changes what the picker offers without a restart.
- `defineTool` decodes arguments at the contribution boundary. `runTool` calls `runJson`. `descriptorOf` is the only place that builds the harness-facing descriptor.
- Host RPC copies live registry keys into `tokens`, `ViewGraph` carries `tokens` next to `active` panels, and the UI imports `Runtime` rather than a plugin. A replacement driver can use another id as long as it lists `Runtime` in `provides`.
- A tool the harness ran itself arrives paired with its output under the same `call_id`. The driver records the pair and derives no `RunTool` work from it. A call without an output stays the driver's work.
