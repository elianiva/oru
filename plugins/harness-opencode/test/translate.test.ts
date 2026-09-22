import { describe, expect, it } from 'vitest'
import type { Schema } from 'effect'
import type { SessionLogOutput } from '@opencode/client/effect/api'
import type { OpenCodeEvent } from '@opencode/client/effect'
import { HarnessEvent } from '@oru/harness'
import { TurnTranslator, callOf } from '../src/opencode/translate.ts'

/**
 * The translation boundary, with typed event fixtures.
 *
 * The bridge reads two channels and the fixtures carry both: the durable log,
 * which is ordered and replayable and so the only place a completion may be
 * read from, and the bus, which carries the fragments that never reach the
 * log. What is proven here is what no single event can say on its own — a
 * call's name from its start, arguments streamed on either channel, the tail a
 * lost fragment left out — plus the two retention rules: an event OpenCode
 * added is kept as `RawUnhandled`, an event the bridge recognises as not its
 * business is not. Nothing here opens a session.
 */

// The envelope is the log's, never the bridge's: the switch reads `type` and
// `data`, so the fixture spells out only what a case asserts on.
// SAFETY: fixtures carry the envelope fields the translator switches on; narrowing to the log output recovers the test double without re-checking the shape.
const durable = (type: string, data: Record<string, Schema.Json>): SessionLogOutput =>
  ({
    id: 'evt_log',
    created: 1,
    type,
    durable: { aggregateID: 'ses_1', seq: 1, version: 1 },
    data,
  }) as SessionLogOutput

// SAFETY: bus fixtures carry the fragment fields the translator reads; narrowing to the bus envelope recovers the test double without re-checking it.
const ephemeral = (type: string, data: Record<string, Schema.Json>): OpenCodeEvent =>
  ({ id: 'evt_bus', created: 2, type, data }) as OpenCodeEvent

const textDelta = (ordinal: number, delta: string) =>
  ephemeral('session.text.delta', { assistantMessageID: 'msg_1', ordinal, delta })

const textEnded = (ordinal: number, text: string) =>
  durable('session.text.ended', { assistantMessageID: 'msg_1', ordinal, text })

const toolStarted = (id: string, name: string) =>
  durable('session.tool.input.started', { assistantMessageID: 'msg_1', id, name })

const argsDelta = (id: string, delta: string) =>
  ephemeral('session.tool.input.delta', { assistantMessageID: 'msg_1', id, delta })

const argsEnded = (id: string, text: string) =>
  durable('session.tool.input.ended', { assistantMessageID: 'msg_1', id, text })

const stepEnded = (input: number) =>
  durable('session.step.ended', {
    assistantMessageID: 'msg_1',
    tokens: { input, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
  })

describe('the call id', () => {
  it('correlates by the message the call belongs to, which is all v2 carries', () => {
    expect(callOf('msg_1', 'tool_1')).toBe('msg_1:tool_1')
  })
})

describe('text fragments', () => {
  it('shows what streamed and says nothing when the boundary repeats it', () => {
    const translator = new TurnTranslator()
    expect(translator.ephemeral(textDelta(0, 'Hello'))).toEqual([
      HarnessEvent.TextDelta({ text: 'Hello' }),
    ])
    expect(translator.durable(textEnded(0, 'Hello'))).toEqual([])
  })

  it('fills only the tail a fragment the bus dropped would have carried', () => {
    const translator = new TurnTranslator()
    translator.ephemeral(textDelta(0, 'Hel'))
    expect(translator.durable(textEnded(0, 'Hello world'))).toEqual([
      HarnessEvent.TextDelta({ text: 'lo world' }),
    ])
  })

  it('counts per ordinal, so a later part of the same message starts fresh', () => {
    const translator = new TurnTranslator()
    translator.ephemeral(textDelta(0, 'first part'))
    expect(translator.durable(textEnded(0, 'first part'))).toEqual([])
    translator.ephemeral(textDelta(1, 'second'))
    expect(translator.durable(textEnded(1, 'second and more'))).toEqual([
      HarnessEvent.TextDelta({ text: ' and more' }),
    ])
  })
})

describe('tool calls', () => {
  it('holds arguments that streamed before the start, then flushes them once', () => {
    const translator = new TurnTranslator()
    expect(translator.ephemeral(argsDelta('tool_1', '{"path"'))).toEqual([])
    expect(translator.durable(toolStarted('tool_1', 'read'))).toEqual([
      HarnessEvent.ToolCallStart({ call_id: 'msg_1:tool_1', name: 'read' }),
      HarnessEvent.ToolCallArgsDelta({ call_id: 'msg_1:tool_1', delta: '{"path"' }),
    ])
    expect(translator.ephemeral(argsDelta('tool_1', '":"a"}'))).toEqual([
      HarnessEvent.ToolCallArgsDelta({ call_id: 'msg_1:tool_1', delta: '":"a"}' }),
    ])
    expect(translator.durable(argsEnded('tool_1', '{"path":"a"}'))).toEqual([])
  })

  it('settles a call with the name only its start carried', () => {
    const translator = new TurnTranslator()
    translator.durable(toolStarted('tool_1', 'read'))
    expect(
      translator.durable(
        durable('session.tool.success', {
          assistantMessageID: 'msg_1',
          id: 'tool_1',
          content: [{ type: 'text', text: 'file body' }],
          executed: true,
        }),
      ),
    ).toEqual([
      HarnessEvent.ToolResult({
        call_id: 'msg_1:tool_1',
        name: 'read',
        ok: true,
        result: 'file body',
      }),
    ])
  })

  it('reports a failure as not ok, with no name when no start was seen', () => {
    const translator = new TurnTranslator()
    expect(
      translator.durable(
        durable('session.tool.failed', {
          assistantMessageID: 'msg_1',
          id: 'tool_2',
          error: { message: 'boom' },
          executed: false,
        }),
      ),
    ).toEqual([
      HarnessEvent.ToolResult({
        call_id: 'msg_1:tool_2',
        name: '',
        ok: false,
        result: 'boom',
      }),
    ])
  })
})

describe('compaction', () => {
  it('reports the size the cut down from, which is the last step before it', () => {
    const translator = new TurnTranslator()
    expect(translator.durable(stepEnded(4200))).toEqual([])
    expect(translator.tokensInput).toBe(4200)
    expect(
      translator.durable(durable('session.compaction.started', { reason: 'auto', recent: 'none' })),
    ).toEqual([HarnessEvent.CompactionStarted({ automatic: true })])
    expect(
      translator.durable(
        durable('session.compaction.ended', {
          reason: 'auto',
          model: 'acme/model-1',
          providerContext: [],
          text: 'the summary',
          recent: 'none',
          cost: 0,
          tokens: { input: 900, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ),
    ).toEqual([
      HarnessEvent.CompactionEnded({
        automatic: true,
        summary: 'the summary',
        tokensBefore: 4200,
        readFiles: [],
        modifiedFiles: [],
      }),
    ])
  })

  it('falls back to the summarizer input count when no step reported one', () => {
    const translator = new TurnTranslator()
    expect(
      translator.durable(
        durable('session.compaction.ended', {
          reason: 'manual',
          model: 'acme/model-1',
          providerContext: [],
          text: 'the summary',
          recent: 'none',
          cost: 0,
          tokens: { input: 700, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }),
      ),
    ).toMatchObject([
      HarnessEvent.CompactionEnded({
        automatic: false,
        summary: 'the summary',
        tokensBefore: 700,
        readFiles: [],
        modifiedFiles: [],
      }),
    ])
  })
})

describe('the completion of a turn', () => {
  it('latches the first terminal and holds it against a later one', () => {
    const translator = new TurnTranslator()
    expect(translator.terminal).toBeUndefined()
    translator.durable(durable('session.execution.succeeded', {}))
    expect(translator.terminal).toEqual({ outcome: 'succeeded' })
    translator.durable(durable('session.execution.interrupted', { reason: 'user' }))
    expect(translator.terminal).toEqual({ outcome: 'succeeded' })
  })

  it('reads a failure message and an interruption reason', () => {
    const failed = new TurnTranslator()
    failed.durable(durable('session.execution.failed', { error: { message: 'provider refused' } }))
    expect(failed.terminal).toEqual({ outcome: 'failed', message: 'provider refused' })

    const stopped = new TurnTranslator()
    stopped.durable(durable('session.execution.interrupted', { reason: 'shutdown' }))
    expect(stopped.terminal).toEqual({ outcome: 'interrupted', reason: 'shutdown' })
  })

  it('warns on a step failure and keeps the turn open', () => {
    const translator = new TurnTranslator()
    expect(
      translator.durable(durable('session.step.failed', { error: { message: 'rate limited' } })),
    ).toEqual([HarnessEvent.ProviderError({ message: 'rate limited', retryable: true })])
    expect(translator.terminal).toBeUndefined()
  })
})

describe('events the bridge has no word for', () => {
  it('keeps an event OpenCode added instead of dropping it quietly', () => {
    expect(new TurnTranslator().durable(durable('session.a.future.thing', { kept: true }))).toEqual(
      [
        HarnessEvent.RawUnhandled({
          type: 'session.a.future.thing',
          payload: '{"kept":true}',
        }),
      ],
    )
  })

  it('stays quiet on the ones it recognises as not its business', () => {
    const translator = new TurnTranslator()
    expect(translator.durable(durable('session.renamed', { title: 'x' }))).toEqual([])
    expect(translator.durable(durable('session.usage.recorded', {}))).toEqual([])
    expect(
      translator.durable(durable('session.compaction.failed', { error: { message: 'x' } })),
    ).toEqual([])
    expect(translator.durable(durable('session.retry.scheduled', { attempt: 1 }))).toEqual([])
    expect(translator.durable(durable('session.execution.started', {}))).toEqual([])
  })

  it('takes fragments from the bus only, never a second copy of a fact', () => {
    const translator = new TurnTranslator()
    expect(
      translator.ephemeral(
        ephemeral('session.tool.success', { assistantMessageID: 'msg_1', id: 't' }),
      ),
    ).toEqual([])
    expect(
      translator.ephemeral(
        ephemeral('session.text.ended', { assistantMessageID: 'msg_1', ordinal: 0, text: 'x' }),
      ),
    ).toEqual([])
    expect(
      translator.ephemeral(
        ephemeral('session.reasoning.delta', {
          assistantMessageID: 'msg_1',
          ordinal: 0,
          delta: 'thinking',
        }),
      ),
    ).toEqual([])
  })
})
