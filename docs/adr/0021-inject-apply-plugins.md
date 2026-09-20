# Plugins declare inject and apply; providing is runtime-discovered

`definePlugin` used to take `needs` plus `provides` plus `server.setup` returning a context, and activation failed both ways when the two disagreed (`ServiceMissing`, `ServiceUndeclared`). That dual-declaration check caught real bugs but every plugin paid for it on every read: six concepts to hold, two places to keep in sync, and a `provides` list that duplicated what `setup` already built. The declaration is now `{ id, scope?, inject?, Config?, apply? }`, and providing happens inside `apply` through `ctx.provide` (services), `ctx.contribute` (data), and `ctx.effect` (disposers). The kernel holds a plugin pending until every inject resolves and reverses everything when one disappears, the way cordis holds on `inject`; bb's manifest plus explicit entries shaped the packaging side.

## Considered options

- **Keep `needs`/`provides` plus the dual check**: the strongest static mismatch errors, but the concept load the rethink set out to kill.
- **Pure cordis `{ name, inject, apply(ctx) }`**: minimal, but it drops the thread scope and typed slots the product needs.
- **Inject list plus runtime discovery** (chosen): one dependency list, no parallel provision list. A duplicate provider fails at activation (`DuplicateProvider`); nothing is checked statically beyond what the types already prove.

## Consequences

- Boot no longer orders providers before consumers statically. It installs in registration order and retries the blocked set until it stops progressing, so a consumer listed before its provider still activates.
- `Activation.provides` names what `apply` actually registered, and cutover diffs the old and new sets rather than trusting a declaration.
- `AnyPlugin` erases inject and config params, so the host carries config as data and provides inject facades around `apply`. The facades, `ProviderReturnKindChanged`, and reverse-order disposal are unchanged.
- Supersedes the declaration half of ADR-0001 and the setup-contribution note in ADR-0006.
