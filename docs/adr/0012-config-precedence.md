# One precedence authority for host settings

The host had flags, `ORU_JOURNAL`, and `ORU_PI_*` reads scattered across `cli.ts` and the pi bridge. Issue #19 needs one place that decides a value, a data directory, and a split between startup-only keys and live ones before a logger or a second listener exists.

## Decision

`apps/host/src/config.ts` resolves settings with Effect `Config` and stacked `ConfigProvider`s. Validation is Effect Schema (`Config.schema`, `onExcessProperty: "error"`). Each resolved value carries its source (`flag`, `file`, `env`, `default`) and its lifetime. Precedence is flags, then `~/.oru/config.json` (or `$ORU_HOME/config.json`), then the environment, then built-in defaults.

Home is chosen first (`--home`, `ORU_HOME`, `~/.oru`) and is never a file key, because the file lives inside it. Data lives under `$home/data`. The listen address defaults to `127.0.0.1`. Widening it is an explicit host setting. Port `0` is valid (ephemeral bind for tests). Effect's `Config.Port` is not used, because that schema starts at 1.

All keys today are startup-only. `config set` writes the file and says the next start reads it. A live key can join later without a second precedence path.

The pi bridge still takes an env bag. The host fills that bag from the resolved settings so product `ORU_PI_*` values are not a second authority. `ORU_PI_E2E_MODEL` and `ORU_PI_TOOLS_FILE` stay out of this layer. A default `pi.sessionDir` follows the winning `pi.home`.

`config list` still prints a fixed name table. That table is not the validator.

## Considered options

- **A `packages/config` package** (bb's `@bb/config` shape): a shared import for plugins that are not the host. Rejected. Only the host process starts, listens, and writes the file. A package would add a layer with one caller.
- **A hand-rolled catalog of parsers**: more code than Effect Config, and a second validation path next to Schema. Rejected. A custom `ConfigProvider` is the intended way to feed flags and a JSON file into the same `Config` program.
- **Live reload of `host` and `port`**: a bind cannot move without closing the listener. Encoding those as startup-only is the point of the lifetime field.

## Consequences

- `config list`, `config set`, and `config unset` are subcommands of `oru-host`.
- `config.json` is created with mode `0600` and must not hold secrets. Unknown keys fail the parse.
- Tests that spawn the binary set `ORU_HOME` to a temp directory so they never write `~/.oru`.
- ADR-0010's default journal path is `$home/data/oru.db`.
