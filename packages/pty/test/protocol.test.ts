import { describe, expect, it } from 'vitest'
import {
  encodeError,
  encodeExit,
  encodeStatus,
  isServerMessage,
  parseClientMessage,
  parsePtyQuery,
} from '../src/protocol.ts'
import { attachPtyPeer, handlePtyFrame, type PtyPeer } from '../src/bridge.ts'
import { baseEnv, clampGrid, defaultShell } from '../src/pty.ts'
import type { PtyHandle } from '../src/pty.ts'

const stubPty = (hooks: {
  readonly written?: string[]
  readonly resized?: Array<{ cols: number; rows: number }>
}): PtyHandle & { data: (text: string) => void; exit: (code: number) => void } => {
  let dataCb: (data: string) => void = () => {}
  let exitCb: (event: { exitCode: number }) => void = () => {}
  return {
    onData: (cb) => {
      dataCb = cb
    },
    onExit: (cb) => {
      exitCb = cb
    },
    write: (data) => {
      hooks.written?.push(data)
    },
    resize: (cols, rows) => {
      hooks.resized?.push({ cols, rows })
    },
    kill: () => {},
    data: (text) => dataCb(text),
    exit: (code) => exitCb({ exitCode: code }),
  }
}

describe('restty dialect', () => {
  it('parses input and resize frames', () => {
    expect(parseClientMessage(`{"type":"input","data":"ls\\n"}`)).toEqual({
      type: 'input',
      data: 'ls\n',
    })
    expect(parseClientMessage(`{"type":"resize","cols":120,"rows":40}`)).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    })
  })

  it('treats unparseable text as raw input', () => {
    expect(parseClientMessage('not json')).toEqual({ raw: 'not json' })
    expect(parseClientMessage(`{"type":"nope"}`)).toEqual({ raw: `{"type":"nope"}` })
  })

  it('recognizes server messages only', () => {
    expect(isServerMessage(`{"type":"exit","code":0}`)).toBe(true)
    expect(isServerMessage('plain output')).toBe(false)
    expect(isServerMessage(`{"type":"input","data":"x"}`)).toBe(false)
  })

  it('encodes status/error/exit', () => {
    expect(encodeStatus('/bin/zsh')).toBe(`{"type":"status","shell":"/bin/zsh"}`)
    expect(encodeError('boom')).toBe(`{"type":"error","message":"boom"}`)
    expect(encodeExit(1)).toBe(`{"type":"exit","code":1}`)
  })

  it('parses upgrade query without trusting cwd', () => {
    expect(parsePtyQuery('?projectId=abc&cols=120&rows=40&shell=/bin/zsh')).toEqual({
      projectId: 'abc',
      cols: 120,
      rows: 40,
      shell: '/bin/zsh',
    })
    expect(parsePtyQuery('?cols=0&rows=-1')).toEqual({
      projectId: undefined,
      cols: undefined,
      rows: undefined,
      shell: undefined,
    })
  })
})

describe('pty bridge', () => {
  it('sends status on open, forwards bytes verbatim, closes on exit', () => {
    const sent: string[] = []
    let closed = false
    const peer: PtyPeer = { send: (data) => sent.push(data), close: () => (closed = true) }
    const pty = stubPty({})
    attachPtyPeer({ peer, pty, shell: '/bin/zsh' })
    pty.data('hello')
    pty.data(`{"type":"exit","code":0}`)
    pty.exit(0)
    expect(sent[0]).toBe(`{"type":"status","shell":"/bin/zsh"}`)
    expect(sent[1]).toBe('hello')
    expect(sent[2]).toBe(`{"type":"exit","code":0}`)
    expect(sent[3]).toBe(`{"type":"exit","code":0}`)
    expect(closed).toBe(true)
  })

  it('routes frames to write/resize', () => {
    const written: string[] = []
    const resized: Array<{ cols: number; rows: number }> = []
    const pty = stubPty({ written, resized })
    const peer: PtyPeer = { send: () => {}, close: () => {} }
    handlePtyFrame(pty, peer, `{"type":"input","data":"ls\\n"}`)
    handlePtyFrame(pty, peer, `{"type":"resize","cols":100,"rows":30}`)
    handlePtyFrame(pty, peer, 'raw keys')
    expect(written).toEqual(['ls\n', 'raw keys'])
    expect(resized).toEqual([{ cols: 100, rows: 30 }])
  })
})

describe('pty spawn helpers', () => {
  it('clamps grid and picks shell', () => {
    expect(clampGrid(0, 1000)).toEqual({ cols: 2, rows: 200 })
    expect(defaultShell({ SHELL: '/bin/fish' })).toBe('/bin/fish')
    expect(defaultShell({})).toBe('/bin/zsh')
  })

  it('filters env to allowlist plus TERM', () => {
    const env = baseEnv({ PATH: '/bin', HOME: '/h', SECRET: 'x' })
    expect(env['TERM']).toBe('xterm-256color')
    expect(env['PATH']).toBe('/bin')
    expect(env['SECRET']).toBeUndefined()
  })
})
