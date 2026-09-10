# The view tree mirrors the active plugin graph

The root submodel holds a keyed collection of active plugin submodels. Activation adds an entry and deactivation removes it. The view folds over the live entries, and each child's OutMessages bubble to the root through the same update loop.

## Considered Options

- **Static composition**: every plugin's UI is always mounted, shown or hidden by state. Simple, but a deactivated plugin still occupies the tree and its state persists after deactivation.
- **Imperative mount/unmount** from facet code: bypasses the single update loop and reintroduces hidden state.
- **Dynamic keyed composition** (chosen): the view is a projection of the active graph, matching the log-driven state model.

## Consequences

- A keyed collection of submodels is less proven in Foldkit than a static child and needs a prototype before it is relied on.
- Activation and deactivation are ordinary messages in the update loop, so the render never observes a half-added plugin.
