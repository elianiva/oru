import { DateTime } from 'effect'
import { describe, expect, it } from 'vitest'
import { SessionMessage } from '@opencode/schema/session-message'
import { Agent } from '@opencode/schema/agent'
import { Money } from '@opencode/schema/money'
import { Model } from '@opencode/schema/model'
import { HarnessEvent } from '@oru/harness'
import { assembleTurn, promptMessageIndex } from '../src/opencode/assemble.ts'

/**
 * The read-back: what the session's projection becomes in oru's record.
 *
 * The projection is what the model was actually shown, so these fixtures carry
 * the message shapes rather than event fragments. What is proven is the pairing
 * that keeps the runtime honest — every call leaves with an output, because a
 * call without one leaves the turn's work pending and the runtime would run
 * oru's tool a second time after the turn ended — plus the usage sum and the
 * messages oru reports no word for. Nothing here opens a session.
 */

type Assistant = Extract<SessionMessage.Info, { readonly type: 'assistant' }>
type AssistantFields = Partial<Pick<Assistant, 'tokens' | 'cost' | 'finish'>>

const user = (id: string, text: string): SessionMessage.Info => ({
  type: 'user',
  id: SessionMessage.ID.make(id),
  time: { created: DateTime.makeUnsafe(1) },
  text,
})

const assistant = (
  id: string,
  content: SessionMessage.AssistantContent[],
  fields: AssistantFields = {},
): Assistant => ({
  type: 'assistant',
  id: SessionMessage.ID.make(id),
  time: { created: DateTime.makeUnsafe(2) },
  agent: Agent.ID.make('build'),
  model: Model.Ref.parse('acme/model-1'),
  content,
  ...fields,
})

const synthetic = (id: string, text: string): SessionMessage.Info => ({
  type: 'synthetic',
  id: SessionMessage.ID.make(id),
  time: { created: DateTime.makeUnsafe(4) },
  text,
})

const spoken = (text: string): SessionMessage.AssistantContent => ({ type: 'text', text })
const thought = (text: string): SessionMessage.AssistantContent => ({ type: 'reasoning', text })
const settled = (id: string, name: string, output: string): SessionMessage.AssistantContent => ({
  type: 'tool',
  id,
  name,
  executed: true,
  state: { status: 'completed', input: {}, content: [{ type: 'text', text: output }] },
  time: { created: DateTime.makeUnsafe(3) },
})
const failed = (id: string, name: string, message: string): SessionMessage.AssistantContent => ({
  type: 'tool',
  id,
  name,
  executed: true,
  state: { status: 'error', input: {}, error: { type: 'ToolError', message } },
  time: { created: DateTime.makeUnsafe(3) },
})
const inFlight = (id: string, name: string, input: string): SessionMessage.AssistantContent => ({
  type: 'tool',
  id,
  name,
  state: { status: 'streaming', input },
  time: { created: DateTime.makeUnsafe(3) },
})
const usage = (input: number, output: number) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: 0, write: 0 },
})

describe('finding the turn inside the session', () => {
  it('locates the prompt the bridge minted, and says when it is not there', () => {
    const messages = [
      user('msg_earlier', 'first'),
      user('msg_prompt', 'hi'),
      user('msg_later', 'mid'),
    ]
    expect(promptMessageIndex(messages, 'msg_prompt')).toBe(1)
    expect(promptMessageIndex(messages, 'msg_absent')).toBe(-1)
  })
})

describe('reading a completed turn back', () => {
  it('renders text, a settled call, and the usage the messages reported', () => {
    const assembly = assembleTurn([
      assistant(
        'msg_a1',
        [spoken('Let me read that.'), settled('tool_1', 'read', 'file body'), spoken('Done.')],
        { tokens: usage(12, 4), cost: Money.USD.make(0.01), finish: 'stop' },
      ),
    ])
    expect(assembly.items).toEqual([
      { type: 'assistant_message', text: 'Let me read that.' },
      { type: 'function_call', call_id: 'msg_a1:tool_1', name: 'read', arguments: '{}' },
      { type: 'tool_result', call_id: 'msg_a1:tool_1', output: 'file body' },
      { type: 'assistant_message', text: 'Done.' },
    ])
    expect(assembly.usage).toEqual({
      input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
      cost: 0.01,
    })
    expect(assembly.stopReason).toBe('stop')
    expect(assembly.unsettledToolResults).toEqual([])
  })

  it('keeps a message admitted mid-turn, which the record otherwise never sees', () => {
    expect(
      assembleTurn([user('msg_mid', 'actually make it blue'), assistant('msg_a2', [spoken('ok')])])
        .items,
    ).toEqual([
      { type: 'user_message', text: 'actually make it blue' },
      { type: 'assistant_message', text: 'ok' },
    ])
  })

  it('sums usage across every message the turn spanned', () => {
    const assembly = assembleTurn([
      assistant('msg_a1', [spoken('one')], { tokens: usage(10, 5) }),
      assistant('msg_a2', [spoken('two')], { tokens: usage(20, 7), cost: Money.USD.make(0.02) }),
    ])
    expect(assembly.usage).toEqual({
      input_tokens: 30,
      output_tokens: 12,
      total_tokens: 42,
      cost: 0.02,
    })
    expect(assembly.stopReason).toBeUndefined()
  })
})

describe('a call the terminal caught mid-flight', () => {
  it('is closed here, so the runtime does not run oru tool a second time', () => {
    const assembly = assembleTurn([
      assistant('msg_a1', [inFlight('tool_1', 'bash', '{"command":"npm')]),
    ])
    expect(assembly.items).toEqual([
      {
        type: 'function_call',
        call_id: 'msg_a1:tool_1',
        name: 'bash',
        arguments: '{"command":"npm',
      },
      {
        type: 'tool_result',
        call_id: 'msg_a1:tool_1',
        output: 'the call had not settled when the turn ended',
      },
    ])
    expect(assembly.unsettledToolResults).toEqual([
      HarnessEvent.ToolResult({
        call_id: 'msg_a1:tool_1',
        name: 'bash',
        ok: false,
        result: 'the call had not settled when the turn ended',
      }),
    ])
  })

  it('settles a failed call with its message, and does not call it unsettled', () => {
    const assembly = assembleTurn([assistant('msg_a1', [failed('tool_1', 'bash', 'not found')])])
    expect(assembly.items).toEqual([
      { type: 'function_call', call_id: 'msg_a1:tool_1', name: 'bash', arguments: '{}' },
      { type: 'tool_result', call_id: 'msg_a1:tool_1', output: 'not found' },
    ])
    expect(assembly.unsettledToolResults).toEqual([])
  })
})

describe('what the record has no word for', () => {
  it('skips reasoning, empty text, and injected context, reporting no usage for none', () => {
    const assembly = assembleTurn([
      assistant('msg_a1', [spoken(''), thought('a private thought')]),
      synthetic('msg_synth', 'injected context'),
      user('msg_user', ''),
    ])
    expect(assembly.items).toEqual([])
    expect(assembly.usage).toBeUndefined()
    expect(assembly.unsettledToolResults).toEqual([])
  })
})
