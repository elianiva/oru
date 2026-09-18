# Configuration

oru keeps one settings file and one data directory under a home directory. The host binary is the only writer. Nothing in `config.json` is a secret.

## Home

The home is `--home`, then `ORU_HOME`, then `~/.oru`. The file is always `config.json` inside that directory. Home itself is not a file key.

On first serve or `config` command the host creates:

- `config.json` with mode `0600`
- `data/` for the journal, logs, and pi sessions

The default journal is `data/oru.db`. The default pi session directory is `data/pi/sessions`.

## Precedence

For every other key the winner is the first of: a launcher flag, the file, the environment, the built-in default. Effect Config reads that stack in `apps/host/src/config.ts`. Schema validates the file and the typed keys. Tests in `apps/host/test/config.test.ts` pin it.

## Commands

```
oru-host config list
oru-host config set <key> <value>
oru-host config unset <key>
```

`--home` works with those commands. `config set` writes the file. Every key today is startup-only, so a running host does not pick the write up. The next start does.

## Keys

| Key               | Flag        | Environment               | Default                  | Lifetime |
| ----------------- | ----------- | ------------------------- | ------------------------ | -------- |
| home              | `--home`    | `ORU_HOME`                | `~/.oru`                 | startup  |
| host              | `--host`    | `ORU_HOST`                | `127.0.0.1`              | startup  |
| port              | `--port`    | `ORU_PORT`                | `7317`                   | startup  |
| journal           | `--journal` | `ORU_JOURNAL`             | `<home>/data/oru.db`     | startup  |
| pi.home           |             | `ORU_PI_HOME`             | `<home>/data/pi`         | startup  |
| pi.sessionDir     |             | `ORU_PI_SESSION_DIR`      | `<pi.home>/sessions`     | startup  |
| pi.command        |             | `ORU_PI_COMMAND`          | unset, so `pi` on `PATH` | startup  |
| pi.args           |             | `ORU_PI_ARGS`             | unset                    | startup  |
| pi.skills         |             | `ORU_PI_SKILLS`           | unset                    | startup  |
| pi.noBuiltinTools |             | `ORU_PI_NO_BUILTIN_TOOLS` | false                    | startup  |

`host` stays loopback unless you set it. That is the whole bind policy.

The file shape is:

```
{
  "host": "127.0.0.1",
  "port": 7317,
  "journal": "/path/oru.db",
  "pi": {
    "home": "/path/pi",
    "sessionDir": "/path/sessions",
    "command": "pi",
    "args": ["--foo"],
    "skills": ["/path/skill"],
    "noBuiltinTools": false
  }
}
```

Unknown keys are rejected.

## Environment the pi bridge sees

The host copies the process environment and overwrites the product `ORU_*` / `ORU_PI_*` names with the resolved values, then provides that bag as the `PiBridgeConfig` service. The bridge reads it through its coeffects, never through a factory parameter. It does not read a second copy of `process.env` for those product keys when the host started it.

Two names stay outside this layer:

- `ORU_PI_E2E_MODEL` is only for the live end-to-end test.
- `ORU_PI_TOOLS_FILE` is a scratch path the bridge sets per child.

The injected pi extension still reads `ORU_PI_TOOLS_FILE` from its own process environment. That is the child's env, which the bridge builds.

## Environment the Claude Code bridge sees

The host hands the Claude Code bridge the process environment unchanged, as the `ClaudeCodeConfig` service. The bridge reads three names out of it: `ORU_CLAUDE_COMMAND` (default `claude`), `ORU_CLAUDE_ARGS` (a JSON array of extra CLI args, unset by default), and `ORU_CLAUDE_SESSION_DIR` (default `~/.oru/claude-code/sessions`, holding one thread-to-session pointer file per thread). `ORU_CLAUDE_E2E_MODEL` is only for the live end-to-end test.
