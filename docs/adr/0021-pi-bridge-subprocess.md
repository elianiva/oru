# The pi harness is a subprocess bridge with an injected extension

`harness-pi` spawns `pi --mode rpc` once per thread session, with `--session <file>` under `~/.oru/pi/sessions/<threadId>.jsonl`, an injected extension file, and pi's own stdin/stdout JSONL as the RPC channel. The injected extension gets a second channel on file descriptors 3 and 4, which is bb's arrangement and is kept for the same reason: the extension has to reach the bridge while pi's stdout is the protocol. Framing is LF-only in both directions — never `readline`, which splits on `U+2028` and `U+2029`, characters pi's protocol allows inside JSON strings.

The extension does what bb's does: register the injected tools and forward their calls, report the session leaf id at `agent_end` (the checkpoint for a fork), run `fork` through pi's `SessionManager`, report pi's model scope at `session_start`, apply the skill roots the runtime configures by passing `--skill` per root, and signal readiness. pi's `extension_ui_request` on stdout is answered cancelled, or pi waits forever for a TUI that is not there.

## Considered options

- **In-process SDK** (`createAgentSessionRuntime`): type-safe, no protocol, no version probe — but a thread's session then lives inside the host process, where a pi fault is an oru fault, and pi's own process semantics are exactly what a bridge is supposed to isolate.
- **Node IPC channel**: a cleaner API than raw descriptors, but pi spawns children that would inherit the channel, and delivery order against pi's own stdout is not guaranteed.
- **fd 3/4 with synchronous writes** (chosen, bb's): out-of-band, inheritance-safe, and ordered against the RPC stream.

## Consequences

- `ORU_PI_COMMAND` and `ORU_PI_ARGS` point the bridge and its version probe at a pi that is not the one on `PATH`; the bridge passes the rest of the environment through with oru's own runtime variables stripped.
- Scratch files — the injected extension, the tools JSON, instruction files — live under a per-process temp directory. Sessions live under `~/.oru/pi/sessions/` with `ORU_PI_SESSION_DIR` as the override. Thread ids are sanitized into file names, which is what makes resume, checkpoint fork, and discard ordinary file operations.
- A stopped or replaced session closes gracefully in order: abort, refresh the leaf id, then escalate to termination. Tool calls still pending when a session goes away are answered as failures rather than left hanging.
- The host never imports pi, so oru's dependency graph does not grow a coding agent and the agent tree stays the user's install.
- Hermetic tests substitute a fake `pi` through `ORU_PI_COMMAND`, which exercises the real spawn, framing, and channel paths without credentials or network.
- Verification comes in two layers. `test/fake-pi.mjs` writes the session entries pi writes — including a tool turn's call and its result — the bridge's own tests drive it through the real channel, and `test/stack.test.ts` composes it with the registry and the inference loop. `test/e2e.test.ts` runs that same stack against the installed pi and a real model, named by `ORU_PI_E2E_MODEL`; it is the only test that spends anything, and it skips without one.
- Skills keep pi's own discovery — its agent dir, the project's `.pi` and `.agents`, its settings — and configured roots are added on top as `--skill` arguments rather than replacing it. oru has no skill source of its own yet, so nothing supplies roots today; the configuration path and its bridge-side handler land with whatever introduces oru skills, and this ADR is the record that the mechanism belongs here rather than in pi's discovery.
- A bridge that spawns a process belongs to a node host. `apps/oru` is a browser app, so it carries the registry and the runtime's own harness; activating pi is the business of whatever node host runs pi, which is why `harness-pi` is not one of the app's plugins.
