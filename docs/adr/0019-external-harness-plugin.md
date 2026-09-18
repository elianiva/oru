# The pi bridge is an external plugin, loaded like any third-party harness

`oru/harness-pi` used to be a static member of the host: `apps/host` imported it, constructed it with the host's resolved environment, and shipped it in the same bundle. No third-party harness could have joined that way, so the plugin API went undogfooded on the exact path it exists for.

The host now loads bridges through a generic plugin-source loader (`apps/host/src/plugin-sources.ts`): a list of module specifiers, each dynamically imported, each read for a plugin through its `default` / `plugin` record. The loader never calls into a module. `oru/harness-pi` is the stock list's first entry. It declares its server facet the way chord plugins do, under an `oru` key in its `package.json`: `{"facets": {"server": "./src/plugin.ts"}}`. The host knows no harness by name: a source that is not installed resolves to no plugins, and the host boots without it.

## Considered options

- **A static import behind a registry table**: one place lists known plugins, but a third party joins only through a host code change, which is the privilege with a new name.
- **Content-addressed facet bundles at startup** (ADR-0001): the kernel's reload seam, but startup would have to build each facet with esbuild first. The loader takes module specifiers and leaves bundling to packaging.
- **A `plugins` key in `config.json`**: user-configured plugin lists are the natural next step, and the loader's source list is shaped for it, but no such key exists today and changing the config shape is a feature, not this refactor.
- **Generic loader with a stock default** (chosen): the host treats its own bridge as an outsider, a missing bridge is an empty registry rather than a boot failure, and third-party harnesses join by extending the source list.
- **Configuration as services, not entry-point arguments**: the loader could have called a `createOruPlugins({ env })` factory per module, but then every test would inject its fake harness through parameters. Instead a plugin reads its environment as a service (`PiBridgeConfig`, `HarnessDefaultsService`), the composition root provides the real value with `Effect.provideService`, and tests provide the scripted one. No escape hatch: the plugin API exports no factory that takes the fake.

## Consequences

- `apps/host` depends on `@oru/harness-pi` only for its config tag, which lives in a dependency-free `@oru/harness-pi/config` subpath so providing the value never pulls in the bridge. The bridge keeps its workspace dependencies for now. Resolving the host's copies through peer dependencies, the way chord externalizes its runtime, belongs with the packaging follow-up below. The bridge's environment reaches it as a service: the host resolves its settings, builds the env bag, and provides it with `Effect.provideService`, which stays visible through the serving layer down to every plugin setup.
- The bridge exposes no ambient singleton and no factory. `harnessPiPlugin` is a constant whose setup opens the bridge from the ambient `PiBridgeConfig` and contributes the harness, so importing the module never reads `process.env`.
- The host boots without pi. `corePlugins` is the no-bridge set the transport suite already composed; the host appends whatever the sources resolve and provides its configured defaults and bridge environment with `Effect.provideService`.
- The `pi.*` config keys keep their shape. Moving the bridge's config into a plugin-owned namespace is the follow-up; this change keeps every key and its precedence so the refactor stays behavior-preserving.
- Build externalization is the other follow-up. The host bundle still includes the bridge, and `pack:smoke` still asserts the extension file ships with it. Unbundling the stock plugin belongs with the packaging story, not here.
- `oru/harness-claude-code` is the second stock source, proving the loader is not a one-bridge special case: the host resolves both bridges through the same specifier list, provides each bridge's config tag beside the other, and the registry lists `pi` and `claude-code` side by side without the host knowing either by name.
