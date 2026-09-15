# One precedence authority for host settings

The host had flags, `ORU_JOURNAL`, and `ORU_PI_*` reads scattered across `cli.ts` and the pi bridge. Issue #19 needs one place that decides a value, a data directory, and a split between startup-only keys and live ones before a logger or a second listener exists.

## Decision

`apps/host/src/config.ts` owns a catalog of keys. Each resolved value carries its source (`flag`, `file`, `env`, `default`) and its lifetime. Precedence is flags, then `~/.oru/config.json` (or `$ORU_HOME/config.json`), then the environment, then the defaults in the catalog.

Home is chosen first (`--home`, `ORU_HOME`, `~/.oru`) and is never a file key, because the file lives inside it. Data lives under `$home/data`. The listen address defaults to `127.0.0.1`. Widening it is an explicit host setting.

All keys in the first catalog are startup-only. `config set` writes the file and says the next start reads it. A live key can join the catalog later without a second precedence path.

The pi bridge still takes an env bag. The host fills that bag from the catalog so product `ORU_PI_*` values are not a second authority. `ORU_PI_E2E_MODEL` and `ORU_PI_TOOLS_FILE` stay out of the catalog.

## Considered options

- **A `packages/config` package** (bb's `@bb/config` shape): a shared import for plugins that are not the host. Rejected. Only the host process starts, listens, and writes the file. A package would add a layer with one caller.
- **Effect `Config` / `ConfigProvider` as the public API**: one more vocabulary next to the catalog, and flags plus a JSON file still need a custom provider. The catalog is the smaller surface.
- **Live reload of `host` and `port`**: a bind cannot move without closing the listener. Encoding those as startup-only is the point of the lifetime field.

## Consequences

- `config list`, `config set`, and `config unset` are subcommands of `oru-host`.
- `config.json` is created with mode `0600` and must not hold secrets. Unknown keys fail the parse.
- Tests that spawn the binary set `ORU_HOME` to a temp directory so they never write `~/.oru`.
- ADR-0010's default journal path is `$home/data/oru.db`.
