import { describe, expect, it } from 'vitest'
import {
  MessageAppended,
  ThreadCreated,
  ToolCompleted,
  ToolRequested,
  TurnStarted,
} from '@oru/kernel'
import { foldThread, workOf } from '../src/session-fold.ts'

describe('session fold', () => {
  it('calls the model after a user message, runs a tool, then calls again', () => {
    const created = ThreadCreated.make({ id: 'e0', thread: 't1' })
    expect(workOf(foldThread([created], 't1'))).toEqual({ _tag: 'Idle' })

    const user = MessageAppended.make({
      id: 'e1',
      thread: 't1',
      role: 'user',
      body: 'hello',
    })
    expect(workOf(foldThread([created, user], 't1'))).toEqual({
      _tag: 'CallModel',
      turn: undefined,
    })

    const turn = TurnStarted.make({ id: 'e2', thread: 't1', turn: 'turn-1' })
    const requested = ToolRequested.make({
      id: 'e3',
      thread: 't1',
      turn: 'turn-1',
      call: 'call_1',
      name: 'echo',
      arguments: '{"text":"hi"}',
    })
    const afterRequest = workOf(foldThread([user, turn, requested], 't1'))
    expect(afterRequest._tag).toBe('RunTool')
    if (afterRequest._tag === 'RunTool') expect(afterRequest.pending.call).toBe('call_1')

    const completed = ToolCompleted.make({
      id: 'e4',
      thread: 't1',
      turn: 'turn-1',
      call: 'call_1',
      name: 'echo',
      ok: true,
      result: '{"echoed":"hi"}',
    })
    expect(workOf(foldThread([user, turn, requested, completed], 't1'))).toEqual({
      _tag: 'CallModel',
      turn: 'turn-1',
    })

    const assistant = MessageAppended.make({
      id: 'e5',
      thread: 't1',
      role: 'assistant',
      body: 'done',
    })
    expect(workOf(foldThread([user, turn, requested, completed, assistant], 't1'))).toEqual({
      _tag: 'Idle',
    })
  })
})
