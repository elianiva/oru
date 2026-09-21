import { describe, expect, it } from 'vitest'
import { Effect, Option, Schema } from 'effect'
import { corePlugins, serveHost } from '../src/index.ts'

/**
 * The PTY backend over the real transport: `POST /pty` spawns a zigpty
 * child, WS `/pty/:id` speaks the restty dialect, and socket close kills
 * the child. Real shell, real socket, no mocks — the same path the panel
 * terminal tab drives from the browser. Real waiting (not fake timers):
 * nothing here can be faked without untesting the path itself.
 */

const PtySessionResponse = Schema.Struct({
  sessionId: Schema.NonEmptyString,
  wsUrl: Schema.String,
})
const decodePtySessionResponse = Schema.decodeUnknownOption(PtySessionResponse)

const PtyListResponse = Schema.Struct({
  sessions: Schema.Array(Schema.Struct({ sessionId: Schema.String })),
})
const decodePtyListResponse = Schema.decodeUnknownOption(PtyListResponse)

const withHost = <A>(effect: (url: string) => Promise<A>): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const running = yield* serveHost({
          plugins: corePlugins,
          hostname: '127.0.0.1',
          port: 0,
        })
        return yield* Effect.promise(() => effect(running.url))
      }),
    ),
  )

const postSession = async (url: string): Promise<string> => {
  const response = await fetch(`${url}/pty`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cols: 80, rows: 24 }),
  })
  expect(response.ok).toBe(true)
  const decoded = decodePtySessionResponse(await response.json())
  expect(Option.isSome(decoded)).toBe(true)
  if (Option.isNone(decoded)) return 'missing-session'
  expect(decoded.value.wsUrl).toBe(`/pty/${decoded.value.sessionId}`)
  return decoded.value.sessionId
}

const sessionsOf = async (url: string): Promise<readonly string[]> => {
  const decoded = decodePtyListResponse(await (await fetch(`${url}/pty`)).json())
  expect(Option.isSome(decoded)).toBe(true)
  if (Option.isNone(decoded)) return []
  return decoded.value.sessions.map((entry) => entry.sessionId)
}

const roundTrip = (url: string, sessionId: string): Promise<readonly string[]> => {
  const { promise, resolve } = Promise.withResolvers<readonly string[]>()
  const wsUrl = `${url.replace(/^http/, 'ws')}/pty/${sessionId}`
  const socket = new WebSocket(wsUrl)
  const received: Array<string> = []
  const done = (): void => {
    try {
      socket.close()
    } catch {
      void 0
    }
    resolve(received)
  }
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'input', data: 'echo pty-ok\n' }))
  })
  socket.addEventListener('message', (event) => {
    received.push(String(event.data))
    if (received.join('').includes('pty-ok')) done()
  })
  // A socket error or an early close resolves with what arrived; the
  // assertion on the output fails the test with the transcript attached.
  socket.addEventListener('error', () => done())
  socket.addEventListener('close', () => done())
  return promise
}

/** Yield the event loop until the session disappears (close kills it). */
const waitForKill = async (url: string, sessionId: string): Promise<boolean> => {
  const deadline = Date.now() + 10_000
  for (;;) {
    if (!(await sessionsOf(url)).includes(sessionId)) return true
    if (Date.now() > deadline) return false
    const { promise, resolve } = Promise.withResolvers<void>()
    setImmediate(() => resolve())
    await promise
  }
}

describe('the pty backend', () => {
  it('spawns, lists, streams a shell round trip, and kills on close', async () => {
    await withHost(async (url) => {
      const sessionId = await postSession(url)
      expect(await sessionsOf(url)).toContain(sessionId)

      const received = await roundTrip(url, sessionId)
      expect(received.join('')).toContain('pty-ok')
      expect(received[0]).toContain('"status"')

      // Socket close kills the child: the session is gone afterwards.
      expect(await waitForKill(url, sessionId)).toBe(true)
    })
  })

  it('rejects unknown projects and unknown sessions', async () => {
    await withHost(async (url) => {
      const badProject = await fetch(`${url}/pty`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'no-such-project' }),
      })
      expect(badProject.status).toBe(404)

      const missing = await fetch(`${url}/pty/missing`, { method: 'DELETE' })
      expect(missing.status).toBe(404)
    })
  })
})
