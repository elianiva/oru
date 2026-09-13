# Chat follows the Inference token, not a plugin id

The Foldkit root opens the thread pane when `ViewGraph.tokens` contains `Inference.key`. It does not check `plugin === 'oru/inference'`. Host RPC copies live registry keys into `tokens`. A replacement engine plugin can use another id as long as it lists `Inference` in `provides`.

## Considered options

- **Key the pane on `inferencePlugin.id`.** Breaks as soon as the engine plugin id is not `oru/inference`.
- **Key the pane on the `Inference` token** (chosen). The token is the RPC contract. Plugin id is an implementation.

## Consequences

- `ViewGraph` carries `tokens` next to `active` panels.
- UI imports `Inference`, not `inferencePlugin`.
