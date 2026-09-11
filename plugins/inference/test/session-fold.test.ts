import { describe, expect, it } from 'vitest'
import {
  chain,
  MessageAppended,
  ThreadCreated,
  ToolCompleted,
  ToolRequested,
  TurnFailed,
  TurnStarted,
  unsignedTree,
} from '@oru/kernel'
import { CallModel, foldThread, Idle, workOf } from '../src/session-fold.ts'

describe('session fold', () => {
  it('calls the model after a user message, runs a tool, then calls again', () => {
    const created = chain([
      ThreadCreated.make({
        ...unsignedTree,
        id: 'e0',
        thread: 't1',
        project: 'p1',
      }),
    ])
    expect(workOf(foldThread(created, 't1'))).toEqual(Idle.make({}))

    const afterUser = chain([
      ThreadCreated.make({
        ...unsignedTree,
        id: 'e0',
        thread: 't1',
        project: 'p1',
      }),
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'hello',
      }),
    ])
    expect(workOf(foldThread(afterUser, 't1'))).toEqual(CallModel.make({ turn: undefined }))

    const afterRequest = chain([
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'hello',
      }),
      TurnStarted.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        turn: 'turn-1',
      }),
      ToolRequested.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        turn: 'turn-1',
        call: 'call_1',
        name: 'echo',
        arguments: '{"text":"hi"}',
      }),
    ])
    const requested = workOf(foldThread(afterRequest, 't1'))
    expect(requested._tag).toBe('RunTool')
    if (requested._tag === 'RunTool') expect(requested.pending.call).toBe('call_1')

    const afterTool = chain([
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'hello',
      }),
      TurnStarted.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        turn: 'turn-1',
      }),
      ToolRequested.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        turn: 'turn-1',
        call: 'call_1',
        name: 'echo',
        arguments: '{"text":"hi"}',
      }),
      ToolCompleted.make({
        ...unsignedTree,
        id: 'e4',
        thread: 't1',
        turn: 'turn-1',
        call: 'call_1',
        name: 'echo',
        ok: true,
        result: '{"echoed":"hi"}',
      }),
    ])
    expect(workOf(foldThread(afterTool, 't1'))).toEqual(CallModel.make({ turn: 'turn-1' }))

    const afterAssistant = chain([
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'hello',
      }),
      TurnStarted.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        turn: 'turn-1',
      }),
      ToolRequested.make({
        ...unsignedTree,
        id: 'e3',
        thread: 't1',
        turn: 'turn-1',
        call: 'call_1',
        name: 'echo',
        arguments: '{"text":"hi"}',
      }),
      ToolCompleted.make({
        ...unsignedTree,
        id: 'e4',
        thread: 't1',
        turn: 'turn-1',
        call: 'call_1',
        name: 'echo',
        ok: true,
        result: '{"echoed":"hi"}',
      }),
      MessageAppended.make({
        ...unsignedTree,
        id: 'e5',
        thread: 't1',
        role: 'assistant',
        body: 'done',
      }),
    ])
    expect(workOf(foldThread(afterAssistant, 't1'))).toEqual(Idle.make({}))

    const afterFail = chain([
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'hello',
      }),
      TurnStarted.make({
        ...unsignedTree,
        id: 'e2',
        thread: 't1',
        turn: 'turn-1',
      }),
      TurnFailed.make({
        ...unsignedTree,
        id: 'e6',
        thread: 't1',
        turn: 'turn-1',
        reason: 'provider down',
      }),
    ])
    expect(workOf(foldThread(afterFail, 't1'))).toEqual(Idle.make({}))
  })
})
