# pi maintenance is reported, not performed

`HarnessService.health` returns a typed `HarnessHealth`: a status (`ready`, `not_installed`, `unauthenticated`, `unsupported_version`, `unknown`), the installed version, the minimum supported version, a message, and an install or update command. oru reports that command; it does not run it. Authentication is read from pi's own credential store — oru stores no model keys and has no login flow of its own.

## Considered options

- **oru runs the install or update**: one click instead of one copy-paste, at the cost of oru mutating a global toolchain the moment a status check says it could.
- **Health as a boolean**: cannot tell "not installed" from "not signed in", which are the two cases that call for different actions.
- **Typed health with a reported command** (chosen): the user gets the diagnosis and the exact command, and decides when to run it.

## Consequences

- The install command follows where pi lives: a bun-managed install gets `bun add -g …@latest`, an npm-global one gets `npm install -g …@latest`, and anything else falls back to `pi update self`.
- The gate is `pi --version` against the minimum supported version, **0.84.0**, the same floor bb uses. Availability of models is the authentication signal, since pi resolves credentials per provider.
- `HarnessService.health` had no consumers before this work, so replacing its shape breaks nothing and needs no migration.
- The gate is memoized briefly, so a picker that asks about health does not shell out to pi on every keystroke.
