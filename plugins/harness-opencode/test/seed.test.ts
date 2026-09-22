import { describe, expect, it } from 'vitest'
import { assistantText, reasoningText, userText, type HistoryItem } from '@oru/harness'
import { Agent } from '@opencode/schema/agent'
import { Model } from '@opencode/schema/model'
import { type SeedContext, seedMessages } from '../src/opencode/seed.ts'

/**
 * The one-shot write of oru's record into OpenCode's own session.
 *
 * A seed runs before the first prompt and never again, so what is proven is
 * the shape OpenCode's projection demands: a call appears only with the output
 * that answers it, a run of assistant-side items becomes one message the way a
 * step writes it, and reasoning stays out because the bridge reports no
 * reasoning. Nothing here opens a session.
 */

const context: SeedContext = {
  agent: Agent.ID.make('build'),
  model: Model.Ref.parse('acme/model-1'),
}

const call = (call_id: string, name: string, args: string): HistoryItem => ({
  type: 'function_call',
  call_id,
  name,
  arguments: args,
})

const answer = (call_id: string, output: string): HistoryItem => ({
  type: 'tool_result',
  call_id,
  output,
})

const replyOf = (seeded: ReturnType<typeof seedMessages>, at: number) => {
  const reply = seeded[at]
  if (reply === undefined || reply.type !== 'assistant')
    expect.fail('expected an assistant message')
  return reply
}

describe('a call and the output that answers it', () => {
  it('seeds an answered call already settled, with its output folded in', () => {
    const seeded = seedMessages(
      [
        userText('read it'),
        call('call_1', 'read', '{"path":"a"}'),
        answer('call_1', 'file body'),
        assistantText('The file says hi'),
      ],
      context,
    )
    expect(seeded).toHaveLength(2)
    expect(seeded[0]).toMatchObject({ type: 'user', text: 'read it' })
    const reply = replyOf(seeded, 1)
    expect(reply.agent).toBe(context.agent)
    expect(reply.model).toEqual(context.model)
    expect(reply.content).toMatchObject([
      {
        type: 'tool',
        id: 'call_1',
        name: 'read',
        state: {
          status: 'completed',
          input: { path: 'a' },
          content: [{ type: 'text', text: 'file body' }],
        },
      },
      { type: 'text', text: 'The file says hi' },
    ])
  })

  it('leaves a call without its output out entirely, or the provider rejects the turn', () => {
    const seeded = seedMessages(
      [userText('go'), call('call_1', 'bash', '{"command":"ls"}'), assistantText('running')],
      context,
    )
    const reply = replyOf(seeded, 1)
    expect(reply.content).toEqual([{ type: 'text', text: 'running' }])
  })
})

describe('how a run of items becomes messages', () => {
  it('puts consecutive assistant-side items in one message, as a step writes them', () => {
    const seeded = seedMessages(
      [
        userText('q'),
        assistantText('a'),
        call('call_1', 'read', '{"path":"a"}'),
        answer('call_1', 'body'),
        assistantText('b'),
        userText('q again'),
        assistantText('c'),
      ],
      context,
    )
    expect(seeded.map((message) => message.type)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(replyOf(seeded, 1).content).toMatchObject([
      { type: 'text', text: 'a' },
      { type: 'tool', id: 'call_1' },
      { type: 'text', text: 'b' },
    ])
    expect(replyOf(seeded, 3).content).toEqual([{ type: 'text', text: 'c' }])
  })

  it('reads arguments the record called JSON but never quite were', () => {
    const seeded = seedMessages(
      [call('call_1', 'bash', 'not json'), answer('call_1', 'ok')],
      context,
    )
    const reply = replyOf(seeded, 0)
    const tool = reply.content[0]
    if (tool === undefined || tool.type !== 'tool') expect.fail('expected a tool part')
    expect(tool.state.status).toBe('completed')
    if (tool.state.status !== 'completed') expect.fail('expected a settled tool')
    expect(tool.state.input).toEqual({})
  })
})

describe('what the bridge reports no capability for', () => {
  it('keeps reasoning out, matching the capability the bridge reports', () => {
    const seeded = seedMessages(
      [userText('q'), reasoningText('a private thought'), assistantText('answer')],
      context,
    )
    expect(replyOf(seeded, 1).content).toEqual([{ type: 'text', text: 'answer' }])
  })

  it('skips user text there is nothing to say', () => {
    const seeded = seedMessages([userText(''), assistantText('answer'), userText('')], context)
    expect(seeded.map((message) => message.type)).toEqual(['assistant'])
  })

  it('has nothing to write for an empty record', () => {
    expect(seedMessages([], context)).toEqual([])
  })
})
