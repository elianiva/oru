# The model is a plugin, not a host Layer

The effect-uai `LanguageModel` service is contributed by a model plugin (`oru/model-demo` in the slice). The inference plugin lists that token in `needs`. The host process does not `Effect.provide` a model Layer onto the program fiber.

## Considered options

- **Fiber Layer** (previous): `demoModelLayer` on `apps/oru` and every test. Inference declared `needs: []` and SAFETY-cast setup so it could `yield* LanguageModel`. The graph could not block or deactivate inference when the model was absent.
- **Kernel-owned Model token**: an oru wrapper in `@oru/kernel`. Kernel would import or duplicate the effect-uai service shape.
- **Model plugin providing `LanguageModel`** (chosen): same `definePlugin` path as every other service (`provides: [LanguageModel]`). Inference stays blocked until a model plugin is active. A later engine that does not use effect-uai simply does not `need` this token.

## Consequences

- `makeHost([echo, inference])` leaves inference in `blocked` with the LanguageModel key missing.
- `deactivate` on the model plugin tears inference down through the existing dependent walk.
- Two plugins that list `LanguageModel` in `provides` still fail `DuplicateProvider`. Swap the model with `host.replace` or deactivate-then-activate.
- The vendor key `@betalyra/effect-uai/LanguageModel` is the graph id until an oru wrapper is worth it.
