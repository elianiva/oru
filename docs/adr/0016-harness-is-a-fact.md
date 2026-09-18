# The harness is a fact, the host owns the defaults, and the picker is a list

A thread with no configuration resolved `preferred()` = the first registered harness. Registration order made that `oru`, and `oru/model-demo` is a scripted double whose cursor lives in its plugin, so an unconfigured thread completed exactly one turn per host process and then failed. The app also had no way to choose: its model action was the literal string `'Medium'`, and `ThreadOptions` answered with the configured harness's catalogue but never said which harness that was. This ADR closes #27 and settles the three decisions that follow.

## Decision

**The host owns the default selection.** `defaultHarness` and `defaultModel` join the config catalog (`apps/host/src/config.ts`), startup-only like every other key (ADR-0012), shipping `pi` for the harness and leaving the model to the harness. The host resolves them and hands them to `oru/harness-registry` when it builds the plugin graph, so `Harnesses.preferred()` returns the configured harness when it is registered and the first by plugin id otherwise. `oru/runtime` reads the same defaults for the model fallback, because a harness plugin must stay generic: it never reads the host's settings.

**The harness is reported, not chosen.** `ThreadOptions` gains `harness`, the effective harness id: the configured one, or the host's default for a thread that names none. `ThreadOptions` also accepts an absent `threadId`, which names a thread that does not exist yet and answers with the host's defaults. The app renders the harness as a fact — its label and its health — and never offers a different one. A harness whose health is not `ready` renders its status, its message, and its install command; the command is copyable and oru never runs it (ADR-0007). `ThreadOptions({ refresh: true })` invalidates the health cache, so a re-check does not restart the host.

**The model is a searchable list.** A harness can report hundreds of models, so the picker is a search over id and label, grouped by provider, marking the harness's own default and offering reasoning levels only for models that report them. A model the harness did not report cannot appear.

**Configuration rides with creation.** `CreateThread` carries `harness`, `model`, and `reasoning`, all optional, so a lazily created thread is born configured in one round trip instead of two, with no window where it runs unconfigured.

## Considered options

- **A harness picker as a user control** (ADR-0006's "three dependent selects"): rejected. Offering the scripted double as a choice is a bug, not a feature, and the harness is a host fact rather than a thread preference.
- **A separate `HostDefaults` service**: a token and a plugin for two strings, and both consumers already read `Harnesses`. Rejected; `Harnesses` gains one synchronous `defaults()`.
- **A new RPC for "the options of a thread that does not exist yet"**: a second method beside `ThreadOptions` with the same body. Rejected; an absent `threadId` says the same thing with one method.
- **A hardcoded `pi` in `preferred()`**: no way for a host to choose otherwise, and it would override the plugin-id order that hermetic test hosts rely on. Rejected; the default is config with a built-in value.
- **A `<select>` for the model**: hundreds of entries and provider grouping. Rejected; search plus grouping.
- **`Schema.optionalKey` on the `CreateThread` payload**: mirrors `ConfigureThread`'s `Schema.UndefinedOr` instead, so both configuration entry points read the same way.

## Consequences

- A host built from settings ships `pi`; a host composed from `corePlugins` carries no configured default and keeps the first-by-plugin-id answer. Hermetic tests are unaffected, and `apps/host/test/e2e.test.ts` asserts the real binary, with no `config.json`, answers an unconfigured thread with pi's catalogue.
- The config catalog grows two startup-only keys, so `config set defaultHarness` writes the file and says the next start reads it. `unset` restores the built-in.
- The app's composer action names the chosen model from its own catalogue and opens the picker; the picker's options are the host's answer, and the pending choice on the home screen is what `CreateThread` receives when a send creates the thread (#51).
- A thread configured to a harness that has since degraded shows the diagnosis above its composer instead of failing opaquely at the next turn; the runtime already records `turn/failed` with `explanationOfHealth`.
- The browser suite starts the vendored pi against a scripted model endpoint and an `ORU_HOME` of its own, so the picker's catalogue is real without a global install or an account. #54 owns the full hermetic walk.
