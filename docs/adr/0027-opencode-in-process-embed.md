# OpenCode is embedded in-process, bound to the activation Scope

oru supports three harness shapes: a CLI spawned per thread (pi, Claude Code), an external process behind a protocol, and an SDK loaded into the host. OpenCode is the first of the third kind, and the question was which shape to give it.

## Decision

The OpenCode bridge embeds `@opencode/sdk/effect` in the host process and boots its Effect program inside oru's activation `Scope`, so the session lives and dies with the plugin's activation. The bridge declares capabilities accordingly: `tools: true` (oru's tools are served in-process), `reasoning: false`, steering by injection, `sessionRestore: true`, `ownsHistory: true`.

## Considered options

- **Per-thread `opencode serve` (a Bridge, option A)**: matches pi and Claude Code and keeps faults isolated, but multiplies a heavyweight server per thread when `Service.ensure` already manages one daemon, and the SDK's Effect program would cross a process boundary it was not designed for.
- **In-process embed bound to activation Scope** (chosen, option B): no process boundary, no side channel, and oru's tools are reachable with `tools: true` because the SDK runs where oru's tool registry runs.
- **Registration/version policy (option C)**: a compatibility layer pinning an SDK version and translating between it and oru's contract. It buys nothing ADR-0007's isolation already bought for a process-shaped harness, and OpenCode is not process-shaped, so the isolation argument does not transfer.

## Consequences

- The agent SDK is in oru's dependency graph; pnpm overrides keep exactly one `effect` version across host and SDK.
- A crash in the embedded program is an oru crash, not a child's exit. Health stays report-never-repair: oru surfaces the failure and never attempts to repair the SDK's state.
- Booting the Effect program costs time on first activation rather than on first use; lazy boot is the follow-up if it shows up in practice.
- oru still owns the record, thread, and turn boundary: the embed changes where OpenCode runs, not who appends facts or ends a turn. A pi fault remains an oru fault only where ADR-0007 said it would; nothing about pi changes here.
