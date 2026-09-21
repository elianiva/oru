import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  closePtySession,
  isPtyUpgrade,
  makePtyStore,
  openPtySession,
  routePtyMessage,
} from '../src/pty.ts'
import type { PtyHandle } from '@oru/pty'

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
  it('claims only /pty/:id upgrades', () => {
    expect(isPtyUpgrade('/pty/abc-123')).toBe(true)
    expect(isPtyUpgrade('/pty/abc-123?cols=80&rows=24')).toBe(true)
    expect(isPtyUpgrade('ws://host/pty/abc-123')).toBe(true)
    expect(isPtyUpgrade('/pty')).toBe(false)
    expect(isPtyUpgrade('/rpc/host')).toBe(false)
    expect(isPtyUpgrade(undefined)).toBe(false)
  })
})

describe('pty sessions', () => {
  const setup = () => {
    const pty = stubPty()
    const store = makePtyStore(
      () => pty,
      () => Effect.succeed([]),
    )
    return { pty, store }
  }

  it('creates sessions in the caller cwd when no project is named', async () => {
    const { store } = setup()
    const session = await Effect.runPromise(store.create({}))
    expect(session).toBeDefined()
    if (session === undefined) return
    expect(session.id.length).toBeGreaterThan(0)
    expect(session.cwd).toBe(process.cwd())
    expect(store.list()).toEqual([{ sessionId: session.id, projectId: undefined }])
  })

  it('greets with status, streams output verbatim, and kills on close', async () => {
    const { pty, store } = setup()
    const session = await Effect.runPromise(store.create({}))
    expect(session).toBeDefined()
    if (session === undefined) return
    const sent: string[] = []
    let closed = false
    openPtySession(
      store,
      `/pty/${session.id}`,
      (data) => sent.push(data),
      () => (closed = true),
    )
    expect(sent).toEqual([`{"type":"status","shell":"${session.shell}"}`])
    pty.emitData('hello')
    expect(sent).toEqual([`{"type":"status","shell":"${session.shell}"}`, 'hello'])
    routePtyMessage(
      store,
      `/pty/${session.id}`,
      `{"type":"input","data":"ls\\n"}`,
      (data) => sent.push(data),
      () => (closed = true),
    )
    expect(pty.written).toEqual(['ls\n'])
    closePtySession(store, `/pty/${session.id}`)
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
      (data) => sent.push(data),
      () => (closed = true),
    )
    expect(sent).toEqual([`{"type":"error","message":"unknown pty session"}`])
    expect(closed).toBe(true)
  })
})
