import { describe, expect, it } from 'vitest'
import { assistantText, userText } from '@oru/harness'
import { isSupportedVersion, parseClaudeCodeVersion } from '../src/claude/launch.ts'
import {
  historyToPrompt,
  isResumeUnknown,
  latestUserText,
  translateLine,
} from '../src/claude/translate.ts'

/**
 * The translation boundary, with inline `stream-json` fixtures.
 *
 * These prove what the bridge reads off each line kind: the session id from
 * the init event, incremental text from partial-message deltas, the fallback
 * text when a run had no deltas, and usage plus failure from the result event.
 * Nothing here spawns a child.
 */

const INIT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: 'session-1',
  model: 'claude-sonnet-5',
})

const DELTA = JSON.stringify({
  type: 'stream_event',
  session_id: 'session-1',
  event: {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Hello' },
  },
})

const ASSISTANT = JSON.stringify({
  type: 'assistant',
  session_id: 'session-1',
  message: {
    id: 'msg-1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text: 'Hello there' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 3, output_tokens: 5 },
  },
})

const SUCCESS = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: 'session-1',
  result: 'Hello there',
  usage: { input_tokens: 10, output_tokens: 4 },
  total_cost_usd: 0.001,
})

const FAILED = JSON.stringify({
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  session_id: 'session-1',
  errors: ['boom'],
})

describe('history to prompt', () => {
  it('sends only the latest user text while a session is resumed', () => {
    const history = [userText('earlier'), assistantText('answer'), userText('again')]
    expect(latestUserText(history)).toBe('again')
  })

  it('has nothing to send when the history ends anywhere else', () => {
    expect(latestUserText([])).toBeUndefined()
    expect(latestUserText([userText('hi'), assistantText('answer')])).toBeUndefined()
    expect(latestUserText([userText('')])).toBeUndefined()
  })

  it('seeds a fresh session with the whole thread as a transcript', () => {
    const history = [userText('earlier question'), assistantText('earlier answer'), userText('hi')]
    expect(historyToPrompt(history)).toBe(
      'User: earlier question\n\nAssistant: earlier answer\n\nUser: hi',
    )
  })

  it('carries tool calls along as text, because v1 forwards no tools', () => {
    const history = [
      {
        type: 'function_call' as const,
        call_id: 'call-1',
        name: 'echo',
        arguments: '{"text":"hi"}',
      },
      { type: 'tool_result' as const, call_id: 'call-1', output: '{"echoed":"hi"}' },
      userText('thanks'),
    ]
    expect(historyToPrompt(history)).toBe(
      'Tool call echo {"text":"hi"}\n\nTool result: {"echoed":"hi"}\n\nUser: thanks',
    )
  })
})

describe('stream-json lines', () => {
  it('takes the session id from the init event', () => {
    const line = translateLine(INIT)
    expect(line?.sessionId).toBe('session-1')
    expect(line?.delta).toBeUndefined()
  })

  it('reads incremental text from partial-message deltas', () => {
    const line = translateLine(DELTA)
    expect(line?.sessionId).toBe('session-1')
    expect(line?.delta).toBe('Hello')
  })

  it('keeps whole assistant messages as the no-delta fallback', () => {
    const line = translateLine(ASSISTANT)
    expect(line?.sessionId).toBe('session-1')
    expect(line?.delta).toBeUndefined()
    expect(line?.assistantText).toBe('Hello there')
  })

  it('reads the final answer and usage from a successful result', () => {
    const line = translateLine(SUCCESS)
    expect(line?.sessionId).toBe('session-1')
    expect(line?.resultText).toBe('Hello there')
    expect(line?.usage).toEqual({
      input_tokens: 10,
      output_tokens: 4,
      total_tokens: 14,
      cost: 0.001,
    })
    expect(line?.failure).toBeUndefined()
  })

  it('reads the reason from a failed result', () => {
    const line = translateLine(FAILED)
    expect(line?.sessionId).toBe('session-1')
    expect(line?.failure).toBe('boom')
    expect(line?.resultText).toBeUndefined()
  })

  it('skips lines it cannot read instead of failing the turn', () => {
    expect(translateLine('')).toBeUndefined()
    expect(translateLine('not json')).toBeUndefined()
    expect(translateLine('{"type":"something-new","session_id":"s"}')?.sessionId).toBe('s')
    expect(translateLine('{"unrelated":true}')).toBeUndefined()
  })
})

describe('resume failures', () => {
  it('recognizes an unknown resumed session, and nothing else', () => {
    expect(isResumeUnknown('Error: resume session abc-123 not found')).toBe(true)
    expect(isResumeUnknown('Unknown session for --resume')).toBe(true)
    expect(isResumeUnknown('Muse exited (code 1, signal null)')).toBe(false)
    expect(isResumeUnknown('the model refused to answer')).toBe(false)
  })
})

describe('Claude versions', () => {
  it('parses what `Muse --version` prints', () => {
    expect(parseClaudeCodeVersion('2.1.8')?.major).toBe(2)
    expect(parseClaudeCodeVersion('2.0.0 (Claude Code)')?.patch).toBe(0)
    expect(parseClaudeCodeVersion('nope')).toBeUndefined()
  })

  it('gates on 2.0.0', () => {
    const old = parseClaudeCodeVersion('1.0.0')
    const minimum = parseClaudeCodeVersion('2.0.0')
    const newer = parseClaudeCodeVersion('2.1.0')
    if (old === undefined || minimum === undefined || newer === undefined) {
      expect.fail('the version fixtures did not parse')
    }
    expect(isSupportedVersion(old)).toBe(false)
    expect(isSupportedVersion(minimum)).toBe(true)
    expect(isSupportedVersion(newer)).toBe(true)
  })
})
