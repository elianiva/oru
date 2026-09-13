# pnpm monorepo: `@oru/kernel` + `oru`, unpublished

The kernel lives in its own package with a strict boundary from the app, and is not published. The boundary keeps the plugin contract honest rather than turning the kernel into a product.

## Considered options

- **Single app, kernel as internal modules**: less ceremony, but the plugin contract has no enforced edge and drifts into the app.
- **Published kernel package**: freezes the contract before it is stable.
- **Unpublished monorepo package** (chosen): the boundary without the commitment.

## Consequences

Internal imports stay package-qualified, and extracting or publishing later is a packaging change rather than a refactor.
