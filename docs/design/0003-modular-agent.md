# Modular coding agent, closed sketch

Kernel stays plugin graph + session log. Drain stays out of the kernel. Host shape follows bb's three planes. Agent loop follows dsh: inbox, kick, stream frames off the log.

## Usage

```ts
const log = yield * SessionLog
yield *
  log.write({
    _tag: 'project/created',
    id,
    project,
    name: 'oru',
    cwd: '/path/to/repo',
  })
yield * log.write({ _tag: 'thread/created', id: threadFact, thread, project })
yield * inference.send(thread, 'fix the test')
```

`send` appends `message/appended` and `agent/inbox/spliced`, then kicks a driver fiber and returns. `whenIdle(thread)` joins that fiber. `WatchThread` is the thread lane, including `thread/created`.

Live tokens use oru frames `start`, `chunk`, and `end` on a side channel, not `SessionEvent`s.

## Shape

- `SessionDraft` goes in and `SessionEvent` comes out. Lanes are `host` and `ThreadId`.
- Plugin planes are `server` in process, `app` UI slots, and `host` daemon for FS/PTY/MCP.
- Loop plugins are model (effect-uai OpenAI-compat), tools, prompt sections, pi compact, and an allow-all permission log.
- Daemon owns workspace I/O. Subagents are threads in the server.

## Synthesis

Tree of `SessionEvent`s over replacing the vocabulary with pi `Entry`. Inbox splice exists; kick is still drain-on-send until the RPC returns after splice only.
