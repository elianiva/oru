# The right panel is a host-owned tab strip over an additive panel slot

The thread's right side was a host-rendered details view with no plugin story, while bb (which this slice dogfoods) lets plugins open tabs from the new-tab Actions list. The terminal needs a home that later tabs — browser, inspectors — can reuse without each one reinventing tab chrome, session scope, and cleanup.

## Decision

The host owns a tab strip: the launcher, the tab order, and the active tab. Plugins fill tabs through a new additive `panel` slot (`PanelProps`: `sessionId`, `projectId`, `threadId`, `title`), one `terminal` definition with N tab instances in v1. The `+` launcher creates a PTY (`POST /pty`, project-cwd-bound, the client never names a cwd) and mounts the tab; closing the tab unmounts it and the host kills the child on socket close. No persistence across reload: identical action+params focus rules and reconnectable sessions are a later slice.

The PTY backend is shared, not plugin-local: `@oru/pty` holds the restty WS dialect codec, the zigpty provisioning helpers, and the peer bridge, and the host serves `POST /pty`, `GET /pty`, `DELETE /pty/:id` plus WS `/pty/:sessionId` on the same origin. `terminal-ghostty` is a thin outsider plugin — a slot claim plus a presentation facet mounting one single-pane restty per tab — so the next panel tab reuses the backend instead of spawning its own server and port.

Two stack calls come with it. The renderer is restty (`libghostty-vt` in WASM, WebGPU with WebGL2 fallback), not xterm.js: its WASM ships as an inlined string, so the single-file tsdown UI bundle keeps working with no `.wasm` asset to emit. The PTY is zigpty over crossws instead of node-pty over `ws`: no compiler toolchain, and one WS stack across runtimes. Effect's NodeHttpServer routes every upgrade through the HTTP app (which 404s it on the same socket, racing crossws's 101), so the host dispatches `/pty/*` upgrades exclusively before Effect ever sees them; every other upgrade passes through untouched.

## Considered options

- **Terminal inside `composer`/`conversation` slots**: poisons exclusive-slot resolution and teaches the wrong pattern; the terminal is not a composer.
- **One-off WS server inside the plugin (own port)**: every future tab reinvents auth, cwd scoping, kill-on-close, and URL discovery. The shared codec plus same-origin `/pty` keeps v1 local but reusable.
- **Full `WsRoute` contribution kind now**: the general mechanism with one consumer; premature. Promotion happens with the second consumer.
- **xterm.js**: the familiar renderer, but a second terminal stack beside the Ghostty-compatible one the team wants to dogfood.
- **node-pty + `ws`**: needs a C++ toolchain per machine and splits the WS stack per plugin.

## Consequences

- Adding a panel tab is: claim the `panel` slot, `POST /pty` for a session, render the def with `PanelProps`. Tab chrome, project scoping, and cleanup come free.
- The UI bundle carries ~5MB of restty+WASM today; a shared-runtime optimization (the recorded ADR-0020 follow-up) shrinks every UI bundle at once when it lands.
- `POST /pty` without a `projectId` spawns in the host cwd — fine for v1, and the place per-thread scoping plus tokens will attach later.
- The details view stays as the fallback while no panel bundle is claimed and no tabs are open, so the panel degrades instead of emptying when the plugin is off.
