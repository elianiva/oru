/**
 * Reusable PTY provisioning over `zigpty`.
 *
 * `zigpty.spawn(cmd, args, {cols, rows, cwd, env})` returns an `IPty` with
 * `onData/onExit/write/resize/kill`. This module keeps the host's view
 * small: spawn with project-cwd binding, filtered env, and kill-on-close.
 * The WS bridge (crossws + restty dialect) lives beside it; both are
 * imported by `terminal-ghostty` today and any panel-tab plugin tomorrow.
 */

export interface PtySpawnOptions {
  readonly cmd: string
  readonly args?: readonly string[]
  readonly cols?: number
  readonly rows?: number
  /** Locked to the resolved project cwd by the caller. Never client input. */
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
}

export interface PtyHandle {
  readonly onData: (callback: (data: string) => void) => void
  readonly onExit: (callback: (event: { readonly exitCode: number }) => void) => void
  readonly write: (data: string) => void
  readonly resize: (cols: number, rows: number) => void
  readonly kill: (signal?: string) => void
}

export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  options: { cols?: number; rows?: number; cwd: string; env?: Readonly<Record<string, string>> },
) => PtyHandle

/**
 * The zigpty handle shape this package adapts, structural so `@oru/pty`
 * never imports the zigpty runtime (it stays an optional peer). Real
 * handles satisfy it; the host passes its `zigpty` spawn through here.
 */
export interface ZigptyPty {
  readonly onData: (listener: (data: string | Buffer) => void) => void
  readonly onExit: (listener: (event: { readonly exitCode: number }) => void) => void
  readonly write: (data: string) => void
  readonly resize: (cols: number, rows: number) => void
  readonly kill: (signal?: string) => void
}

/** Adapt a zigpty handle to the host's handle: bytes as UTF-8 text. */
export const fromZigpty = (pty: ZigptyPty): PtyHandle => ({
  onData: (callback) => {
    pty.onData((data) => {
      callback(String(data))
    })
  },
  onExit: (callback) => {
    pty.onExit((event) => {
      callback({ exitCode: event.exitCode })
    })
  },
  write: (data) => {
    pty.write(data)
  },
  resize: (cols, rows) => {
    pty.resize(cols, rows)
  },
  kill: (signal) => {
    pty.kill(signal)
  },
})

/** Default shell: `$SHELL` fallback `zsh → bash → sh` (restty playground rule). */
export const defaultShell = (env: NodeJS.ProcessEnv = process.env): string => {
  const shell = env['SHELL']
  if (shell !== undefined && shell.length > 0) return shell
  return process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'
}

/** Clamp grid sizes to what zigpty and restty both accept. */
export const clampGrid = (cols?: number, rows?: number) => ({
  cols: Math.min(Math.max(cols ?? 80, 2), 500),
  rows: Math.min(Math.max(rows ?? 24, 2), 200),
})

/** The filtered environment a PTY child inherits. */
export interface PtyEnv {
  readonly [key: string]: string
}

/** Minimal env allowlist for PTY children. Callers add `TERM=xterm-256color`. */
export const baseEnv = (env: NodeJS.ProcessEnv = process.env): PtyEnv => {
  const keep = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'SHELL', 'EDITOR', 'VISUAL', 'PAGER']
  const entries: Array<[string, string]> = []
  for (const key of keep) {
    const value = env[key]
    if (value !== undefined) entries.push([key, value])
  }
  return { TERM: 'xterm-256color', ...Object.fromEntries(entries) }
}

export const spawnPty = async (spawnFn: SpawnFn, options: PtySpawnOptions): Promise<PtyHandle> => {
  const grid = clampGrid(options.cols, options.rows)
  return spawnFn(options.cmd, [...(options.args ?? [])], {
    cols: grid.cols,
    rows: grid.rows,
    cwd: options.cwd,
    env: { ...baseEnv(), ...(options.env ?? {}) },
  })
}
