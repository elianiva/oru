# Panels are plugin metadata; slots are claimed from apply

The plugin record used to carry `ui` twice over: the `ui` facet (code) and a `ui` metadata field (panel title) that the view graph decoded. One name for a bundle and a title is a standing invitation to confuse them, so the metadata field is now `panel`. And UI claims used to be static `provides` on the server record, which the snapshot joined to bundles; they are now registered from `apply` through the `slot()` helper in `@oru/ui`, an effect that reverses on deactivation like every other contribution. The snapshot still joins live claims to startup-built code by plugin id, and the slot inventory, exclusive-versus-additive kinds, and Foldkit submodels inside each def are unchanged.

## Considered options

- **Keep static `provides` for UI**: claims visible before activation, but a second declaration system beside `apply` registrations.
- **Keep the `ui` metadata name**: one rename against every future misreading.
- **Panel metadata plus apply-time claims** (chosen): the record says what the view lists, `apply` says what it fills, and one reversal path covers both.

## Consequences

- Amends ADR-0002 (facets keep their meaning; the record no longer carries the facet) and notes in ADR-0004 and ADR-0020.
- The kernel never imports `@oru/ui`: `slot()` is a thin helper over `ctx.contribute`, so the contribution kind still owns its type.
