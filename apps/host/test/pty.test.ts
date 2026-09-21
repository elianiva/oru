import { describe, expect, it } from 'vitest'
import { Effect, Predicate, Schema } from 'effect'
import {
  closePtySession,
  isPtyUpgrade,
  makePtyStore,
  openPtySession,
  routePtyMessage,
  type PtyStore,
} from '../src/pty.ts'
import type { PtyHandle } from '@oru/pty'
import type { SpawnFn } from '@oru/pty'

const stubPty = (): PtyHandle & {
  written: string[]
  resized: Array<{ cols: number; rows: number }>
  killed: boolean
  emitData: (data: string) => void
  emitExit: (code: number) => void
} => {
  const written: Array<string> = []
  const resized: Array<{ cols: number; rows: number }> = []
  let dataCb: (data: string) => void = () => {}
  let exitCb: (event: { exitCode: number }) => void = () => {}
  let killed = false
  return {
    written,
    resized,
    get killed() {
      return killed
    },
    onData: (cb) => {
      dataCb = cb
    },
    onExit: (cb) => {
      exitCb = cb
    },
    write: (data) => {
      written.push(data)
    },
    resize: (cols, rows) => {
      resized.push({ cols, rows })
    },
    kill: () => {
      killed = true
    },
    emitData: (data: string): void => {
      dataCb(data)
    },
    emitExit: (code: number): void => {
      exitCb({ exitCode: code })
    },
  }
}

describe('pty upgrade routing', () => {
  it('claims exactly /pty/:id upgrades', () => {
    expect(isPtyUpgrade('/pty/abc-123')).toBe(true)
    expect(isPtyUpgrade('/pty/abc-123?cols=80&rows=24')).toBe(true)
    expect(isPtyUpgrade('ws://host/pty/abc-123')).toBe(true)
    expect(isPtyUpgrade('/pty')).toBe(false)
    expect(isPtyUpgrade('/pty/abc/def')).toBe(false)
    expect(isPtyUpgrade('/rpc/host')).toBe(false)
    expect(isPtyUpgrade(undefined)).toBe(false)
  })
})

describe('pty sessions', () => {
  const setup = (spawn: SpawnFn = () => stubPty()) => {
    const store = makePtyStore(spawn, () => Effect.succeed([]))
    return { store }
  }

  const create = (store: PtyStore) => Effect.runPromise(store.create({}))

  it('creates sessions in the caller cwd when no project is named', async () => {
    const { store } = setup()
    const session = await create(store)
    expect(session).toBeDefined()
    if (session === undefined) return
    expect(session.id.length).toBeGreaterThan(0)
    expect(session.cwd).toBe(process.cwd())
    expect(session.peerId).toBeUndefined()
    expect(store.list()).toEqual([{ sessionId: session.id, projectId: undefined }])
  })

  it('greets with status, streams output verbatim, and kills on close', async () => {
    const pty = stubPty()
    const { store } = setup(() => pty)
    const session = await create(store)
    expect(session).toBeDefined()
    if (session === undefined) return
    const sent: string[] = []
    let closed = false
    openPtySession(
      store,
      `/pty/${session.id}`,
      'peer-1',
      (data) => sent.push(data),
      () => {
        closed = true
      },
    )
    expect(sent).toEqual([`{"type":"status","shell":"${session.shell}"}`])
    pty.emitData('hello')
    expect(sent).toEqual([`{"type":"status","shell":"${session.shell}"}`, 'hello'])
    routePtyMessage(
      store,
      `/pty/${session.id}`,
      `{"type":"input","data":"ls\\n"}`,
      (data) => sent.push(data),
      () => {
        closed = true
      },
    )
    expect(pty.written).toEqual(['ls\n'])
    closePtySession(store, `/pty/${session.id}`, 'peer-1')
    expect(pty.killed).toBe(true)
    expect(store.get(session.id)).toBeUndefined()
    expect(closed).toBe(false)
  })

  it('rejects unknown sessions with an error frame', () => {
    const { store } = setup()
    const sent: string[] = []
    let closed = false
    openPtySession(
      store,
      '/pty/missing',
      'peer-1',
      (data) => sent.push(data),
      () => {
        closed = true
      },
    )
    expect(sent).toEqual([`{"type":"error","message":"unknown pty session"}`])
    expect(closed).toBe(true)
  })

  it('rejects a second peer while one is live, and ignores its close', async () => {
    const pty = stubPty()
    const { store } = setup(() => pty)
    const session = await create(store)
    expect(session).toBeDefined()
    if (session === undefined) return
    const first: string[] = []
    openPtySession(
      store,
      `/pty/${session.id}`,
      'peer-1',
      (data) => first.push(data),
      () => {},
    )
    expect(first).toHaveLength(1)

    const second: string[] = []
    let secondClosed = false
    openPtySession(
      store,
      `/pty/${session.id}`,
      'peer-2',
      (data) => second.push(data),
      () => {
        secondClosed = true
      },
    )
    expect(second).toEqual([`{"type":"error","message":"terminal busy"}`])
    expect(secondClosed).toBe(true)

    // The rejected peer's close must not kill the live session.
    closePtySession(store, `/pty/${session.id}`, 'peer-2')
    expect(pty.killed).toBe(false)
    expect(store.get(session.id)).toBeDefined()
    pty.emitData('still here')
    expect(first).toContain('still here')
  })

  it('caps concurrent sessions', async () => {
    const store = makePtyStore(
      () => stubPty(),
      () => Effect.succeed([]),
      { maxSessions: 1 },
    )
    const first = await create(store)
    expect(first).toBeDefined()
    const failure = await Effect.runPromise(Effect.flip(store.create({})))
    expect(Predicate.isTagged(failure, 'SessionsExhausted')).toBe(true)
  })

  it('reaps sessions nobody ever connected to', async () => {
    let at = 0
    const dead = stubPty()
    const store = makePtyStore(
      () => dead,
      () => Effect.succeed([]),
      {
        idleMs: 60_000,
        now: () => at,
      },
    )
    const orphan = await create(store)
    expect(orphan).toBeDefined()
    if (orphan === undefined) return
    at = 61_000
    const next = await create(store)
    expect(next).toBeDefined()
    expect(dead.killed).toBe(true)
    expect(store.get(orphan.id)).toBeUndefined()
  })

  it('reports spawn failures instead of defecting', async () => {
    class SpawnBoom extends Schema.TaggedError<SpawnBoom>()('SpawnBoom', {}) {}
    const store = makePtyStore(
      () => {
        throw new SpawnBoom()
      },
      () => Effect.succeed([]),
    )
    const failure = await Effect.runPromise(Effect.flip(store.create({})))
    expect(Predicate.isTagged(failure, 'SpawnFailure')).toBe(true)
  })
})
