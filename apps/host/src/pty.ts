import { randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { foldProject, type SessionEvent, type SessionLogError } from '@oru/kernel'
import {
  attachPtyPeer,
  clampGrid,
  defaultShell,
  encodeError,
  handlePtyFrame,
  spawnPty,
  type PtyHandle,
  type SpawnFn,
} from '@oru/pty'

/**
 * Reusable host PTY backend (`POST /pty`, WS `/pty/:sessionId`).
 *
 * Sessions are project-cwd-bound: `POST /pty {projectId}` resolves the
 * cwd via the session log's `foldProject` and rejects unknown projects.
 * The client never supplies `cwd` or `shell`; the shell is always the
 * host default. WS speaks the restty dialect (`@oru/pty` codec). One live
 * peer per session: a second socket gets an error and closes, and the
 * socket close kills the zigpty child. `terminal-ghostty` is the first
 * consumer; future panel tabs reuse this.
 */

export interface PtySession {
  readonly id: string
  readonly projectId: string | undefined
  readonly cwd: string
  readonly shell: string
  readonly pty: PtyHandle
  readonly peerId: string | undefined
  readonly createdAt: number
}

export class SpawnFailure extends Schema.TaggedError<SpawnFailure>()('SpawnFailure', {
  reason: Schema.String,
}) {}

export class SessionsExhausted extends Schema.TaggedError<SessionsExhausted>()(
  'SessionsExhausted',
  { count: Schema.Number },
) {}

export type PtyCreateError = SessionLogError | SpawnFailure | SessionsExhausted

export interface PtyStore {
  readonly create: (input: {
    readonly projectId?: string | undefined
    readonly cols?: number | undefined
    readonly rows?: number | undefined
  }) => Effect.Effect<PtySession | undefined, PtyCreateError>
  readonly get: (id: string) => PtySession | undefined
  readonly kill: (id: string) => boolean
  readonly attach: (id: string, peerId: string) => boolean
  readonly list: () => ReadonlyArray<{ sessionId: string; projectId: string | undefined }>
}

export interface PtyStoreOptions {
  readonly maxSessions?: number
  readonly idleMs?: number
  readonly now?: () => number
}

/** Reads the session log without context: the store closes over the log value. */
export type ReadEntries = () => Effect.Effect<readonly SessionEvent[], SessionLogError>

export const makePtyStore = (
  spawn: SpawnFn,
  readEntries: ReadEntries,
  options?: PtyStoreOptions,
): PtyStore => {
  const sessions = new Map<string, PtySession>()
  const maxSessions = options?.maxSessions ?? 16
  const idleMs = options?.idleMs ?? 60_000
  const now = options?.now ?? Date.now

  /** Drop sessions nobody ever connected to: a POST with no WS leaks a child. */
  const reapIdle = (at: number): void => {
    for (const [id, session] of sessions) {
      if (session.peerId === undefined && at - session.createdAt > idleMs) {
        sessions.delete(id)
        try {
          session.pty.kill()
        } catch {
          void 0
        }
      }
    }
  }

  const create = (input: {
    readonly projectId?: string | undefined
    readonly cols?: number | undefined
    readonly rows?: number | undefined
  }): Effect.Effect<PtySession | undefined, PtyCreateError> =>
    Effect.gen(function* () {
      reapIdle(now())
      if (sessions.size >= maxSessions) {
        return yield* new SessionsExhausted({ count: sessions.size })
      }
      const entries = yield* readEntries()
      let cwd = process.cwd()
      if (input.projectId !== undefined) {
        const named = foldProject(entries, input.projectId)
        if (named === undefined) return undefined
        cwd = named.cwd
      }
      const grid = clampGrid(input.cols, input.rows)
      const shell = defaultShell()
      const id = randomUUID()
      const createdAt = now()
      const settled = yield* Effect.promise(() =>
        spawnPty(spawn, { cmd: shell, args: [], cols: grid.cols, rows: grid.rows, cwd }).then(
          (handle) => ({ spawned: true as const, handle }),
          () => ({ spawned: false as const }),
        ),
      )
      if (!settled.spawned) {
        return yield* new SpawnFailure({ reason: 'pty spawn failed' })
      }
      const pty = settled.handle
      const session: PtySession = {
        id,
        projectId: input.projectId,
        cwd,
        shell,
        pty,
        peerId: undefined,
        createdAt,
      }
      sessions.set(id, session)
      return session
    })

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

  const attach = (id: string, peerId: string): boolean => {
    const session = sessions.get(id)
    if (session === undefined || session.peerId !== undefined) return false
    sessions.set(id, { ...session, peerId })
    return true
  }

  const list = (): ReadonlyArray<{ sessionId: string; projectId: string | undefined }> =>
    [...sessions.values()].map((session) => ({
      sessionId: session.id,
      projectId: session.projectId,
    }))

  return { create, get, kill, attach, list }
}

const sessionIdOf = (url: string | undefined): string | undefined => {
  if (url === undefined) return undefined
  // Peers hand us absolute URLs (`http://host/pty/<id>`); the wire carries
  // origin-form (`/pty/<id>`). Accept both, and only exactly `/pty/<id>`,
  // so future `/pty/*` routes are never swallowed by the exclusive dispatch.
  let path = url
  try {
    path = new URL(url).pathname
  } catch {
    path = url.split('?')[0] ?? ''
  }
  const parts = path.split('/').filter((part) => part.length > 0)
  if (parts.length !== 2 || parts[0] !== 'pty') return undefined
  const id = parts[1]
  if (id === undefined || id.length === 0) return undefined
  try {
    return decodeURIComponent(id)
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
  handlePtyFrame(session.pty, { send, close }, text)
}

/** crossws `open` hook body: greet with `{status}` and stream output. */
export const openPtySession = (
  store: PtyStore,
  url: string | undefined,
  peerId: string,
  send: (data: string) => void,
  close: () => void,
): void => {
  const id = sessionIdOf(url)
  const session = id === undefined ? undefined : store.get(id)
  if (id === undefined || session === undefined) {
    send(encodeError('unknown pty session'))
    close()
    return
  }
  if (!store.attach(id, peerId)) {
    send(encodeError('terminal busy'))
    close()
    return
  }
  attachPtyPeer({ peer: { send, close }, pty: session.pty, shell: session.shell })
}

/**
 * crossws `close` hook body: kill-on-close, one PTY per tab. Only the
 * attached peer kills; a rejected second peer's close leaves the live
 * session alone.
 */
export const closePtySession = (store: PtyStore, url: string | undefined, peerId: string): void => {
  const id = sessionIdOf(url)
  if (id === undefined) return
  const session = store.get(id)
  if (session === undefined || session.peerId !== peerId) return
  store.kill(id)
}
