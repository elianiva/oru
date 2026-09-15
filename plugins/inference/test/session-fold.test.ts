import { describe, expect, it } from 'vitest'
import {
  ApprovalDecided,
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
    expect(requested._tag).toBe('AwaitApproval')
    if (requested._tag === 'AwaitApproval') expect(requested.pending.call).toBe('call_1')

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

  it('opens a turn for the next request, and runs a call id a new turn reuses', () => {
    const first = [
      MessageAppended.make({
        ...unsignedTree,
        id: 'e1',
        thread: 't1',
        role: 'user',
        body: 'hello',
      }),
      TurnStarted.make({ ...unsignedTree, id: 'e2', thread: 't1', turn: 'turn-1' }),
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
    ]
    expect(workOf(foldThread(chain(first), 't1'))).toEqual(Idle.make({}))

    // The answered turn is closed, so the next request starts its own.
    const afterRequest = chain([
      ...first,
      MessageAppended.make({
        ...unsignedTree,
        id: 'e6',
        thread: 't1',
        role: 'user',
        body: 'again',
      }),
    ])
    expect(workOf(foldThread(afterRequest, 't1'))).toEqual(CallModel.make({ turn: undefined }))

    // A bridge reusing the call id in the new turn is asking again, not
    // repeating a call this thread already ran.
    const afterReuse = chain([
      ...first,
      MessageAppended.make({
        ...unsignedTree,
        id: 'e6',
        thread: 't1',
        role: 'user',
        body: 'again',
      }),
      TurnStarted.make({ ...unsignedTree, id: 'e7', thread: 't1', turn: 'turn-2' }),
      ToolRequested.make({
        ...unsignedTree,
        id: 'e8',
        thread: 't1',
        turn: 'turn-2',
        call: 'call_1',
        name: 'echo',
        arguments: '{"text":"again"}',
      }),
    ])
    const reused = workOf(foldThread(afterReuse, 't1'))
    expect(reused._tag).toBe('AwaitApproval')
    if (reused._tag === 'AwaitApproval') expect(reused.pending.turn).toBe('turn-2')
  })

  it('runs a tool only after approve, and records a denied call as failed work', () => {
    const requested = [
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
    ]
    const approved = chain([
      ...requested,
      ApprovalDecided.make({
        ...unsignedTree,
        id: 'e3a',
        thread: 't1',
        request: 'call_1',
        decision: 'approve',
      }),
    ])
    const run = workOf(foldThread(approved, 't1'))
    expect(run._tag).toBe('RunTool')

    const denied = chain([
      ...requested,
      ApprovalDecided.make({
        ...unsignedTree,
        id: 'e3d',
        thread: 't1',
        request: 'call_1',
        decision: 'deny',
      }),
    ])
    expect(workOf(foldThread(denied, 't1'))._tag).toBe('RecordDenied')

    const duplicate = chain([
      ...requested,
      ToolRequested.make({
        ...unsignedTree,
        id: 'e3b',
        thread: 't1',
        turn: 'turn-1',
        call: 'call_1',
        name: 'echo',
        arguments: '{"text":"hi"}',
      }),
    ])
    expect(foldThread(duplicate, 't1').pending).toHaveLength(1)

    const other = chain([
      MessageAppended.make({
        ...unsignedTree,
        id: 'b1',
        thread: 't2',
        role: 'user',
        body: 'hello',
      }),
      TurnStarted.make({ ...unsignedTree, id: 'b2', thread: 't2', turn: 'turn-b' }),
      ToolRequested.make({
        ...unsignedTree,
        id: 'b3',
        thread: 't2',
        turn: 'turn-b',
        call: 'call_1',
        name: 'echo',
        arguments: '{"text":"hi"}',
      }),
    ])
    expect(workOf(foldThread(chain(requested), 't2'))._tag).toBe('Idle')
    expect(workOf(foldThread(other, 't2'))._tag).toBe('AwaitApproval')
    expect(
      workOf(
        foldThread(
          chain([
            ...requested,
            ApprovalDecided.make({
              ...unsignedTree,
              id: 'e3a',
              thread: 't1',
              request: 'call_1',
              decision: 'approve',
            }),
          ]),
          't2',
        ),
      )._tag,
    ).toBe('Idle')
  })
})
