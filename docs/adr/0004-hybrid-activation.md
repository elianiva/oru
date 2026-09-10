# Hybrid activation: static graph at boot, reactive coeffects at runtime

Plugins declare coeffects through their context. The kernel resolves the full graph at boot and activates providers before consumers. It also watches the service registry at runtime, reactively activating and deactivating plugins whose coeffects appear or disappear.

## Considered Options

- **Static only**: predictable and cheap, gives reversible effects (temporal composability) on `Effect.Scope` alone, but no spatial composability.
- **Reactive only**: the full spatial guarantee on every path, at the cost of carrying reactive resolution into boot.
- **Hybrid** (chosen): static resolution at boot, reactive resolution on runtime changes.

## Consequences

The service registry is observable, and plugin declarations describe coeffects as data so the registry can diff them. Boot runs without the reactive watcher, so a static graph is valid on its own.
