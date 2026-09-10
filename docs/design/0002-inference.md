# Inference plugin — Unit 6 (`@oru/inference`)

Synthesized from architect Phase B. Base: candidate A (log-driven facet). Grafted from B: `ThreadRpc` as a separate group (`CreateThread`, `SendMessage`, `WatchThread`). `Loop`, kernel `Thread` / `Session` / `ThreadRuns` / `ToolRegistry`, and `LanguageModel` as a graph coeffect were rejected.

## Problem

Callers need to send a user message and persist a turn plus a tool call on the session log, without leaking effect-uai types into `SessionEvent` or adding an `AgentRuntime` service.

## Usage (caller's view)

```ts
const host = yield * makeHost([echoToolPlugin, fakeModelPlugin, inferencePlugin])
const inference = yield * host.service(Inference)
yield * inference.send('t1', 'hello')
const tags = (yield * log.entries).map((event) => event._tag)
```

RPC later: `ThreadRpc.SendMessage` / `WatchThread`, not `HostRpc`.

## Shape

`SessionEvent` gains ADR-0007 tags with JSON strings and `EventId`s. `makeHost` provides `SessionLog` into `setup` and `ctx.contributions`. Tools stay `contribute(ToolKind)`. Each tool `execute`s a JSON argument string. `Model` is an oru token whose methods return Effects (kernel facades only forward Effects). `send` appends `message/appended` and drains `foldThread` / `workOf` until `Idle`.
