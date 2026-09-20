# Plugin config is data on the def, not a service

Bridges used to read their environment as Context services (`PiBridgeConfig`, `ClaudeCodeConfig`, `HarnessDefaultsService`), provided by the composition root through a dependency-free `./config` subpath so providing the value never pulled in the bridge. That worked but every plugin paid the split-export dance, and a function-valued field (`log`) rode along inside what was supposed to be data. A plugin now declares `Config` as a Schema on the def; the host decodes per-plugin data against it and hands the value to `apply`. Services stay for method bags, which facades can forward; plain data goes through `Config`.

## Considered options

- **Config as services** (ADR-0019): ambient, testable through `provideService`, but the `./config` split exists only to route around the import it creates.
- **Factory parameters only**: honest, but the loader never calls into a module, so there is nowhere to pass them.
- **Schema on the def** (chosen): the declaration names its own shape, the host owns resolution, and tests hand literals through the configs map, the same path the app takes.

## Consequences

- A bridge's child environment is a string record used as-is, so a scripted test stays hermetic; absent config the bridge runs on `process.env`. Functions are not data, so `log` stays a direct parameter of `openPiHarness`/`openClaudeCodeHarness` for unit use and out of `Config`.
- The `./config` subpaths and their service tags are gone; `apps/host` knows no bridge by name beyond the plugin list.
- Supersedes the configuration half of ADR-0019.
