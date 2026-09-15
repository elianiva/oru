import { describe, expect, it } from 'vitest'
import {
  MessageAppended,
  SessionActivated,
  ToolCompleted,
  ToolRequested,
  TurnFailed,
  TurnStarted,
  unsignedTree,
} from '@oru/kernel'
import {
  FailedLine,
  labelOf,
  lineOf,
  ToolCompletedLine,
  ToolRequestedLine,
  TurnLine,
  UserLine,
} from '../src/transcript.ts'

describe('transcript', () => {
  it('projects thread facts into labeled lines and drops host facts', () => {
    expect(
      lineOf(
        SessionActivated.make({
          ...unsignedTree,
          id: 'p1',
          plugin: 'logging',
          scope: 'host',
        }),
      ),
    ).toBeUndefined()

    const user = lineOf(
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'hello',
      }),
    )
    expect(user).toEqual(UserLine.make({ body: 'hello' }))
    if (user === undefined) throw new Error('expected user line')
    expect(labelOf(user)).toBe('user: hello')

    const turn = lineOf(
      TurnStarted.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        turn: 'turn_1',
      }),
    )
    expect(turn).toEqual(TurnLine.make({}))
    if (turn === undefined) throw new Error('expected turn line')
    expect(labelOf(turn)).toBe('turn/started')

    const failed = lineOf(
      TurnFailed.make({
        ...unsignedTree,
        id: 'e2f',
        thread: 't1',
        turn: 'turn_1',
        reason: 'provider down',
      }),
    )
    expect(failed).toEqual(FailedLine.make({ reason: 'provider down' }))
    if (failed === undefined) throw new Error('expected failed line')
    expect(labelOf(failed)).toBe('turn/failed provider down')

    const requested = lineOf(
      ToolRequested.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        turn: 'turn_1',
        call: 'call_1',
        name: 'echo',
        arguments: '{}',
      }),
    )
    expect(requested).toEqual(ToolRequestedLine.make({ name: 'echo', call: 'call_1' }))
    if (requested === undefined) throw new Error('expected tool request line')
    expect(labelOf(requested)).toBe('tool/requested echo')

    const completed = lineOf(
      ToolCompleted.make({
        ...unsignedTree,
        id: 'e4',
        thread: 't1',
        turn: 'turn_1',
        call: 'call_1',
        name: 'echo',
        ok: true,
        result: '{}',
      }),
    )
    expect(completed).toEqual(ToolCompletedLine.make({ name: 'echo', call: 'call_1' }))
    if (completed === undefined) throw new Error('expected tool completed line')
    expect(labelOf(completed)).toBe('tool/completed echo')
  })
})
