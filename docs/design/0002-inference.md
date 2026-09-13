# Inference plugin, unit 6 (`@oru/inference`)

Synthesized from architect Phase B. Base: candidate A (log-driven facet). Grafted from B: `ThreadRpc` as a separate group (`CreateThread`, `SendMessage`, `WatchThread`). `Loop`, kernel `Thread` / `Session` / `ThreadRuns` / `ToolRegistry` were rejected. `LanguageModel` is a coeffect of the inference plugin, provided by a model plugin. It is not a kernel token.

## Problem

Callers need to send a user message and persist a turn plus a tool call on the session log, without leaking effect-uai types into `SessionEvent` or adding an `AgentRuntime` service.

## Usage (caller's view)

```ts
const host = yield * makeHost([echoToolPlugin, demoModelPlugin, inferencePlugin])
const inference = yield * host.service(Inference)
yield * inference.send('t1', 'hello')
const tags = (yield * log.entries).map((event) => event._tag)
```

RPC later: `ThreadRpc.SendMessage` / `WatchThread`, not `HostRpc`.

## Shape

`SessionEvent` gains ADR-0003 tags with JSON strings and `EventId`s. `makeHost` provides `SessionLog` into `setup` and `ctx.contributions`. Tools stay `ToolKind.of(spec)`. Each tool `execute`s a JSON argument string. A model plugin `provide`s effect-uai `LanguageModel`. Inference lists that token in `needs`. `send` appends `message/appended` and drains `foldThread` / `workOf` until `Idle`.
