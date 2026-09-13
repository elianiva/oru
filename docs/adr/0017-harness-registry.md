# Many harnesses on one host; a thread picks one

A host keeps several harnesses active at once. A harness plugin contributes its service as a data contribution under `HarnessKind` (`oru/harness`), the same way a tool plugin contributes under `ToolKind`. A small `oru/harness-registry` plugin provides the `Harnesses` service, which answers from the live contribution set, and `oru/inference` needs `Harnesses` instead of `Harness`. A thread records which harness it runs and the runtime resolves it per turn. The single-provider `Harness` token is deleted.

## Considered options

- **One `Harness` token, swapped per host** (previous): one harness per host. Two harnesses collide as `DuplicateProvider`, and swapping the running one is a `host.replace` that changes every thread at once.
- **Per-thread plugin scope** (ADR-0009): the oru-native answer, and where this ends up, but the registry is a flat map keyed by token and activation scopes are keyed by plugin, so it needs a scoped registry first. Nothing here depends on it.
- **`HarnessKind` contribution plus a `Harnesses` registry** (chosen): the kernel already carries opaque contribution payloads (`defineContributionKind`), so two harness plugins never collide on a token, activation stays the plugin's own business, and the view keeps mirroring the active graph.

## Consequences

- `@oru/harness` exports `HarnessKind`, the `Harnesses` service and token, and the `HarnessService` interface. `Harness` as a token goes away and every caller migrates in one cut: inference, harness-oru, harness-pi, the app's fixtures, and the architecture test.
- Inference activates whether or not a harness is installed. A thread naming an unknown harness fails at its turn, not at boot.
- The registry answers from contributions on each call, so activating or deactivating a harness plugin changes what the picker offers without a restart.
- `Harnesses` appears in the graph's service tokens, so the presentation facet lists harnesses without importing the inference plugin (ADR-0016).
- A harness plugin's own coeffects are unchanged (`harness-oru` still needs `LanguageModel`); only its provision changes from a token to a contribution.
- A bridge whose service is assembled from a coeffect contributes at setup rather than after activation, so `PluginContext` carries `contribute`: a plugin adds to its own contribution set while it is being set up, and deactivating it reverses every contribution by plugin id (ADR-0006). `harness-pi` needs this because its service is built from the process environment it was handed, not from anything the host injects later.
