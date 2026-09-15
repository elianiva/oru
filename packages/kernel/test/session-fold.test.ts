import { describe, expect, it } from 'vitest'
import {
  MessageAppended,
  SessionActivated,
  ThreadCreated,
  ThreadContextWindow,
  TurnUsage,
  chain,
  foldThreadContextWindow,
  foldThreadUsage,
  leafOf,
  pathFromLeaf,
  relink,
  threadLane,
  unsignedTree,
} from '../src/index.ts'
import { foldNamedThreads } from '../src/session-fold.ts'

describe('foldNamedThreads', () => {
  it('names a thread from thread/created without any messages', () => {
    const created = ThreadCreated.make({
      ...unsignedTree,
      id: 'e1',
      thread: 't1',
      project: 'p1',
    })
    expect([...foldNamedThreads([created])]).toEqual(['t1'])
  })

  it('names a thread from later work facts and ignores plugin facts', () => {
    const events = [
      SessionActivated.make({
        ...unsignedTree,
        id: 'e1',
        plugin: 'logging',
        scope: 'host',
      }),
      MessageAppended.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't2',
        role: 'user',
        body: 'hi',
      }),
    ]
    expect([...foldNamedThreads(events)]).toEqual(['t2'])
  })
})

describe('session tree', () => {
  it('walks parentId to the leaf and ignores an abandoned sibling', () => {
    const root = ThreadCreated.make({
      ...unsignedTree,
      id: 'e0',
      thread: 't1',
      project: 'p1',
    })
    const user = relink(
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'a',
      }),
      1,
      root.id,
    )
    const abandoned = relink(
      MessageAppended.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        role: 'assistant',
        body: 'old',
      }),
      2,
      user.id,
    )
    const kept = relink(
      MessageAppended.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        role: 'assistant',
        body: 'new',
      }),
      3,
      user.id,
    )
    const events = [root, user, abandoned, kept]
    expect(leafOf(events, threadLane('t1'))).toBe('e3')
    expect(pathFromLeaf(events, 'e3').map((event) => event.id)).toEqual(['e0', 'e1', 'e3'])
    expect(abandoned.id).toBe('e2')
  })
})

describe('foldThreadUsage', () => {
  it('sums turn usage on the lane and keeps the latest context window', () => {
    const events = chain([
      ThreadCreated.make({
        ...unsignedTree,
        id: 'e0',
        thread: 't1',
        project: 'p1',
      }),
      TurnUsage.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        turn: 'turn-1',
        inputTokens: 10,
        outputTokens: 4,
        cost: 0.02,
      }),
      ThreadContextWindow.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        tokens: 80,
        contextWindow: 200,
      }),
      TurnUsage.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        turn: 'turn-2',
        inputTokens: 2,
        outputTokens: 1,
        cost: undefined,
      }),
      ThreadContextWindow.make({
        ...unsignedTree,
        id: 'e4',
        thread: 't1',
        tokens: 90,
        contextWindow: 200,
      }),
    ])
    expect(foldThreadUsage(events, 't1')).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cost: 0.02,
    })
    expect(foldThreadContextWindow(events, 't1')).toEqual({ tokens: 90, contextWindow: 200 })
    expect(foldThreadUsage(events, 't2')).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cost: undefined,
    })
  })
})
