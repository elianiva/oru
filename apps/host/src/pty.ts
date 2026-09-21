import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { foldProject, type SessionEvent, type SessionLogError } from '@oru/kernel'
import {
  attachPtyPeer,
  baseEnv,
  clampGrid,
  defaultShell,
  encodeError,
  handlePtyFrame,
  parsePtyQuery,
  type PtyHandle,
} from '@oru/pty'

/**
 * Reusable host PTY backend (`POST /pty`, WS `/pty/:sessionId`).
 *
 * Sessions are project-cwd-bound: `POST /pty {projectId}` resolves the
 * cwd via the session log's `foldProject` and rejects unknown projects.
 * The client never supplies `cwd`. WS speaks the restty dialect
 * (`@oru/pty` codec); the socket close kills the zigpty child.
 * `terminal-ghostty` is the first consumer; future panel tabs reuse this.
 */

export interface PtySession {
  readonly id: string
  readonly projectId: string | undefined
  readonly cwd: string
  readonly shell: string
  readonly pty: PtyHandle
}

export type ZigptySpawn = (
  cmd: string,
  args: readonly string[],
  options: { cols?: number; rows?: number; cwd: string; env?: Record<string, string> },
) => PtyHandle

export interface PtyStore {
  readonly create: (input: {
    readonly projectId?: string | undefined
    readonly cols?: number | undefined
    readonly rows?: number | undefined
    readonly shell?: string | undefined
  }) => Effect.Effect<PtySession | undefined>
  readonly get: (id: string) => PtySession | undefined
  readonly kill: (id: string) => boolean
  readonly list: () => ReadonlyArray<{ sessionId: string; projectId: string | undefined }>
}

/** Reads the session log without context: the store closes over the log value. */
export type ReadEntries = () => Effect.Effect<readonly SessionEvent[], SessionLogError>

export const makePtyStore = (spawnFn: ZigptySpawn, readEntries: ReadEntries): PtyStore => {
  const sessions = new Map<string, PtySession>()

  const create = (input: {
    readonly projectId?: string | undefined
    readonly cols?: number | undefined
    readonly rows?: number | undefined
    readonly shell?: string | undefined
  }): Effect.Effect<PtySession | undefined> =>
    Effect.gen(function* () {
      const entries = yield* readEntries().pipe(Effect.orDie)
      let cwd = process.cwd()
      if (input.projectId !== undefined) {
        const named = foldProject(entries, input.projectId)
        if (named === undefined) return undefined
        cwd = named.cwd
      }
      const grid = clampGrid(input.cols, input.rows)
      const shell = input.shell ?? defaultShell()
      const id = randomUUID()
      const pty = spawnFn(shell, [], {
        cols: grid.cols,
        rows: grid.rows,
        cwd,
        env: { ...baseEnv(), TERM: 'xterm-256color' },
      })
      const session: PtySession = { id, projectId: input.projectId, cwd, shell, pty }
      sessions.set(id, session)
      return session
    }).pipe(Effect.orDie)

  const get = (id: string): PtySession | undefined => sessions.get(id)

  const kill = (id: string): boolean => {
    const session = sessions.get(id)
    if (session === undefined) return false
    sessions.delete(id)
    try {
      session.pty.kill()
    } catch {
      void 0
    }
    return true
  }

  const list = (): ReadonlyArray<{ sessionId: string; projectId: string | undefined }> =>
    [...sessions.values()].map((session) => ({
      sessionId: session.id,
      projectId: session.projectId,
    }))

  return { create, get, kill, list }
}

const sessionIdOf = (url: string | undefined): string | undefined => {
  if (url === undefined) return undefined
  // Peers hand us absolute URLs (`http://host/pty/<id>`); the wire carries
  // origin-form (`/pty/<id>?…`). Accept both, never trust more than the id.
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split('?')[0] ?? ''
  }
  const parts = path.split('/').filter((part) => part.length > 0)
  if (parts[0] !== 'pty' || parts[1] === undefined || parts[1].length === 0) return undefined
  try {
    return decodeURIComponent(parts[1])
  } catch {
    return undefined
  }
}

export const isPtyUpgrade = (url: string | undefined): boolean => sessionIdOf(url) !== undefined

/** crossws `message` hook body: route one text frame into zigpty. */
export const routePtyMessage = (
  store: PtyStore,
  url: string | undefined,
  text: string,
  send: (data: string) => void,
  close: () => void,
): void => {
  const id = sessionIdOf(url)
  if (id === undefined) {
    send(encodeError('unknown pty session'))
    close()
    return
  }
  const session = store.get(id)
  if (session === undefined) {
    send(encodeError('unknown pty session'))
    close()
    return
  }
  const query = parsePtyQuery(`?${url?.split('?')[1] ?? ''}`)
  if (query.cols !== undefined && query.rows !== undefined) {
    try {
      session.pty.resize(query.cols, query.rows)
    } catch {
      void 0
    }
  }
  handlePtyFrame(session.pty, { send, close }, text)
}

/** crossws `open` hook body: greet with `{status}` and stream output. */
export const openPtySession = (
  store: PtyStore,
  url: string | undefined,
  send: (data: string) => void,
  close: () => void,
): void => {
  const id = sessionIdOf(url)
  const session = id === undefined ? undefined : store.get(id)
  if (session === undefined) {
    send(encodeError('unknown pty session'))
    close()
    return
  }
  attachPtyPeer({ peer: { send, close }, pty: session.pty, shell: session.shell })
}

/** crossws `close` hook body: kill-on-close, one PTY per tab. */
export const closePtySession = (store: PtyStore, url: string | undefined): void => {
  const id = sessionIdOf(url)
  if (id === undefined) return
  store.kill(id)
}
