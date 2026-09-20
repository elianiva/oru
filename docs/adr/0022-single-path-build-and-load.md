# One bundler, one manifest shape, one load path

The build used to run esbuild for the server facet and tsdown for the UI facet, read `oru.facets` in `package.json`, accepted `default` or `plugin` envelopes, and discovered UI claims two ways: from the server record's static `provides`, or from the ui entry's `defs`. The host then chose between three load paths: source import, prebuilt `dist/facets` record, or the kernel's content-addressed loader. Every duality was a branch a reader had to hold and a mismatch the loader had to forgive. The build is now tsdown for both facets, the manifest key is `oru: { server, ui }`, modules default-export their record, UI claims always come from the ui entry's `defs`, and the host loads one path: manifest, then record, prebuilt bytes when they verify, source bundling when they don't. The sha address stays as a cache-buster for `/ui/<address>.js`, and the stock plugin list lives in `apps/host/oru.plugins.json` instead of a static import.

## Considered options

- **Keep esbuild plus the fallbacks**: two bundlers, three load paths, silent forgiveness everywhere. It boots through anything and explains nothing.
- **Single bundler with one claim path and one load path** (chosen): a source bundle and a prebuilt bundle are byte-identical by construction (pinned cwd, inline options only), so the manifest can name bytes without caring which side produced them.

## Consequences

- `prebuilt-parity` proves source and disk serve identical assignments and addresses; the prebuilt tests rebuild unconditionally so no stale `dist` output can pass.
- The packed host ships `oru.plugins.json` beside `dist`; a missing list boots with no external plugins and a note, never a guess.
- `esbuild` leaves the dependency tree.
