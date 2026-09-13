# Tool contributions are JSON, not effect-uai Tool values

`ToolKind` (`oru/tool`) carries name, description, an Effect Schema, and `runJson`. The contribution does not hold `@effect-uai/core/Tool`. The inference plugin maps contributions to effect-uai tools inside `seam.ts` when it calls the model.

## Considered options

- **Store `Tool.AnyLocalTool` on the contribution** (previous): echo and any tool plugin import effect-uai types through `@oru/inference`. A Pi or ACP engine cannot read that payload.
- **Kernel-owned tool kind**: echo would import only `@oru/kernel`. Kernel would then own a tools vocabulary that design 0001 leaves to packages.
- **JSON `runJson` on an inference-owned kind** (chosen): tool plugins depend on `@oru/inference` for the kind, not for `Tool`. A later engine can ignore `ToolKind` or read the same JSON contract.

## Consequences

- `defineTool` decodes arguments at the contribution boundary.
- `runTool` calls `runJson`. It does not call `Tool.execute`.
- `toolkitOf` is the only place that builds effect-uai `Tool.make` values.
