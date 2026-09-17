# How to debug a host failure, a pi bridge failure, and a stuck turn

Reproduce the failure, then read the stream or file this page names. The host and the bridge write to the process streams.

## Environment variables

| Variable                  | What it changes                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORU_JOURNAL`             | SQLite journal file. Default `$home/data/oru.db` (`~/.oru/data/oru.db`). Tests pass `--journal` or this variable so they do not write to your home directory. |
| `VITE_ORU_HOST_URL`       | Host the browser talks to. Empty means the page origin. In `pnpm dev`, Vite forwards `/rpc` to `127.0.0.1:7317`.                                              |
| `ORU_PI_COMMAND`          | Binary the pi bridge spawns. Default is `pi` on `PATH`.                                                                                                       |
| `ORU_PI_ARGS`             | JSON array of extra arguments for that binary.                                                                                                                |
| `ORU_PI_NO_BUILTIN_TOOLS` | When set, the bridge passes `--no-builtin-tools` to pi.                                                                                                       |
| `ORU_PI_SESSION_DIR`      | Directory for pi session files. Default `$home/data/pi/sessions`.                                                                                             |
| `ORU_PI_HOME`             | pi home directory. Default `$home/data/pi`.                                                                                                                   |
| `ORU_PI_E2E_MODEL`        | Real model for the host and harness-pi spend tests. Those tests skip when this is unset.                                                                      |

## What to read

| Place                                  | When                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Host stdout                            | The listening URL. A healthy start prints `oru host listening on http://...`.                       |
| Host stderr                            | Bind failures, journal errors, and other boot failures. The line starts with `oru host failed:`.    |
| Host process streams after start       | The host writes to the process streams. Keep the terminal that launched `oru-host`.                 |
| Journal file                           | Session facts after a crash. Open the path `ORU_JOURNAL` or `--journal` named.                      |
| pi stderr                              | The bridge copies pi's stderr as `pi[<pid>]: ...` and keeps a 4096-byte tail on `PiRpcChildExited`. |
| `oru harness-pi:` lines on host stderr | Dropped pi UI requests, unreadable channel lines, and other bridge warnings.                        |

## Reproduce a host failure

1. Start a host on the default port: `pnpm --filter @oru/host start`.
2. In a second terminal, start another host on the same port with a throwaway journal: `pnpm --filter @oru/host start -- --journal /tmp/oru-qa-collision.db`.
3. The second process prints `oru host failed:` to stderr and exits 1.

A bad `--journal` path that the process cannot create fails the same way, with the SQL driver's message after `oru host failed:`.

## Reproduce a pi bridge failure

1. Start the app: `ORU_PI_COMMAND=/nonexistent/pi-binary pnpm dev`.
2. Open the printed URL.
3. In the thread pane, pick the pi harness.
4. Type a message and click **Send**.

The host stays up. The pi harness reports `not_installed`. Host stderr has no listening-line failure. If a spawn exits after that, the bridge prints `pi exited` and the stderr tail.

Hermetic proof without the UI lives in `plugins/harness-pi/test/pi-bridge.test.ts` (`reports a missing pi instead of failing the thread`).

## Reproduce a stuck turn

1. Start `pnpm dev` with the default demo model.
2. Open the printed URL and wait for the thread pane.
3. Type a message and click **Send**.
4. While the live lines still show a running tool or streamed text, click **Stop**.

The pane's Stop control is `[data-thread-stop]`. A prompt is sent with `NO_REQUEST_TIMEOUT` (`plugins/harness-pi/src/pi/session.ts`), so a pi that accepts the spawn and never replies stays open until Stop or SIGTERM. The ready gate still waits 30 seconds for the channel `ready` line. Other `PiRpcChild.request` calls default to 30 seconds. To hold a turn open against a fake pi, point `ORU_PI_COMMAND` at a process that accepts the spawn and never replies.

If the whole host is wedged, send SIGTERM to `oru-host`. The process closes its scope, the kernel deactivates the pi bridge, and the bridge stops every pi child.

## Browser check

The [README browser check](../../README.md#browser-check) is the manual pass. CI runs the same flows under Playwright. On failure, Playwright keeps a screenshot and CI uploads `apps/oru/test-results/`, including `host.log`.
