#!/usr/bin/env node

/**
 * A scripted `pi --mode rpc` for hermetic bridge tests.
 *
 * It speaks the subset of pi's RPC dialect the bridge drives, framed the way pi
 * frames it (LF-delimited JSON), and loads the bridge's injected extension the
 * way pi loads it: through a resolve hook that aliases the bare specifiers pi
 * bundles, then `default(api)` with a minimal extension API, then `session_start`
 * in pi's position. Everything else — fd 3/4, the tool channel, `agent_settled` —
 * travels the real path the bridge uses, so a test exercises the bridge rather
 * than a mock of it.
 *
 * Scripted prompts:
 *   `<text>`               one assistant turn, `Response to: <text>`
 *   `/tool <name> <json>`  runs the registered tool first, then answers with its text
 *   `/fail`                the run ends with an assistant error, as a provider failure does
 *   `/hold`                a run that stays open until `abort` or a steer
 *   `/die`                 the process exits mid-run, without answering
 * A prompt while a run is live is queued and reported through `queue_update`,
 * the way pi's follow-up queue does.
 *
 * `FAKE_PI_VERSION` answers `--version`. `FAKE_PI_MODE_LOG` records every command
 * type the bridge sent, so a test can assert what the bridge did and did not do.
 * `FAKE_PI_TOOLS_DUMP` records every registered tool as the model would see it.
 * `FAKE_PI_ARGV_DUMP` records the arguments this process was launched with.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)

if (process.env.FAKE_PI_ARGV_DUMP !== undefined) {
  appendFileSync(process.env.FAKE_PI_ARGV_DUMP, `${JSON.stringify(args)}\n`)
}

if (args.includes('--version')) {
  process.stdout.write(`${process.env.FAKE_PI_VERSION ?? '0.84.0'}\n`)
  process.exit(0)
}

const flag = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const sessionFile = args.includes('--no-session') ? undefined : flag('--session')
const extensionPath = flag('--extension')
const modeLog = process.env.FAKE_PI_MODE_LOG

const MODELS = [
  {
    id: 'fake-model',
    name: 'Fake Model',
    provider: 'fake-provider',
    input: ['text'],
    reasoning: true,
    contextWindow: 200_000,
  },
  {
    id: 'fake-mini',
    name: 'Fake Mini',
    provider: 'fake-provider',
    input: ['text'],
    reasoning: false,
    contextWindow: 32_000,
  },
]

let model = MODELS[0]
const requestedModel = flag('--model')
if (requestedModel !== undefined) {
  const [provider, id] = requestedModel.split('/')
  model = MODELS.find((entry) => entry.provider === provider && entry.id === id) ?? MODELS[0]
}

let thinkingLevel = flag('--thinking') ?? 'medium'
let isStreaming = false
let messageCount = 0
let tokens = 0
let idCounter = 0
let leafId = null
let holdAbort = null
const followUp = []
const extensionTools = new Map()
const extensionHandlers = new Map()
let activeTools = ['read', 'bash', 'edit', 'write']

// ---- session file: pi's format, written entry by entry ----

const appendEntry = (type, rest) => {
  if (sessionFile === undefined) return undefined
  const id = (++idCounter).toString(16).padStart(8, '0')
  appendFileSync(
    sessionFile,
    `${JSON.stringify({
      type,
      id,
      parentId: leafId,
      timestamp: new Date().toISOString(),
      ...rest,
    })}\n`,
  )
  leafId = id
  return id
}

if (sessionFile !== undefined) {
  mkdirSync(dirname(sessionFile), { recursive: true })
  if (!existsSync(sessionFile) || readFileSync(sessionFile, 'utf8').trim() === '') {
    writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: 'session',
        version: 3,
        id: 'fake-session',
        timestamp: new Date().toISOString(),
        cwd: process.cwd(),
      })}\n`,
      'utf8',
    )
  } else {
    // A resumed session: the leaf is the last entry the file already has.
    for (const line of readFileSync(sessionFile, 'utf8').trim().split('\n').slice(1)) {
      try {
        leafId = JSON.parse(line).id ?? leafId
      } catch {
        // A line the file's writer half-finished; pi's own reader skips those too.
      }
    }
  }
}

// ---- transports ----

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
const respond = (id, command, data) => {
  const answer = { id, type: 'response', command, success: true }
  // pi omits `data` for commands that answer with nothing.
  if (data !== undefined) answer.data = data
  send(answer)
}
const respondError = (id, command, error) => {
  send({ id, type: 'response', command, success: false, error })
}
const event = (payload) => {
  send(payload)
}

const readLines = (input, onLine) => {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  input.on('data', (chunk) => {
    const text = decoder.write(chunk)
    let start = 0
    for (;;) {
      const index = text.indexOf('\n', start)
      if (index === -1) {
        pending += text.slice(start)
        return
      }
      const line = pending + text.slice(start, index)
      pending = ''
      start = index + 1
      onLine(line)
    }
  })
}

// ---- the injected extension, loaded the way pi loads it ----

const extensionContext = {
  cwd: process.cwd(),
  get sessionManager() {
    return { getLeafId: () => leafId }
  },
  model,
  scopedModels: [{ model }],
  hasUI: false,
  mode: 'rpc',
}

const emitExtensionEvent = async (type, payload = {}) => {
  for (const handler of extensionHandlers.get(type) ?? []) {
    await handler({ type, ...payload }, extensionContext)
  }
}

const loadExtension = async (path) => {
  const aliases = new Map([
    ['@earendil-works/pi-coding-agent', import.meta.resolve('@earendil-works/pi-coding-agent')],
    ['typebox', import.meta.resolve('typebox')],
  ])
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = aliases.get(specifier)
      return url ? { url, shortCircuit: true } : nextResolve(specifier, context)
    },
  })
  const module = await import(pathToFileURL(path).href)
  module.default({
    registerTool(tool) {
      extensionTools.set(tool.name, tool)
    },
    on(type, handler) {
      const handlers = extensionHandlers.get(type) ?? []
      handlers.push(handler)
      extensionHandlers.set(type, handlers)
    },
    getActiveTools: () => [...activeTools],
    setActiveTools(names) {
      activeTools = [...names]
    },
  })
  if (process.env.FAKE_PI_TOOLS_DUMP !== undefined) {
    for (const tool of extensionTools.values()) {
      appendFileSync(
        process.env.FAKE_PI_TOOLS_DUMP,
        `${JSON.stringify({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })}\n`,
      )
    }
  }
  if (process.env.FAKE_PI_ACTIVE_TOOLS_DUMP !== undefined) {
    appendFileSync(process.env.FAKE_PI_ACTIVE_TOOLS_DUMP, `${JSON.stringify(activeTools)}\n`)
  }
  await emitExtensionEvent('session_start')
}

/**
 * Run a tool through the extension. The extension owns fd 3/4: it forwards the
 * call to the bridge and resolves with the bridge's answer, exactly as it does
 * under real pi.
 */
const runExtensionTool = async (toolCallId, name, toolArgs) => {
  const tool = extensionTools.get(name)
  event({ type: 'tool_execution_start', toolCallId, toolName: name, args: toolArgs })
  let text = ''
  let isError = false
  if (tool === undefined) {
    text = `no tool ${name}`
    isError = true
  } else {
    try {
      const result = await tool.execute(toolCallId, toolArgs, new AbortController().signal)
      text = (result?.content ?? []).map((block) => block.text ?? '').join('\n')
    } catch (error) {
      text = error instanceof Error ? error.message : String(error)
      isError = true
    }
  }
  event({
    type: 'tool_execution_end',
    toolCallId,
    toolName: name,
    result: { content: [{ type: 'text', text }], details: {} },
    isError,
  })
  return { text, isError }
}

/**
 * A tool turn, the way pi writes one: the assistant asks for the call, pi runs
 * it, and the answer lands in the session as a `toolResult` entry. The bridge
 * assembles its turn from those entries, so a fake that only wrote the final
 * text would hide the call and its output from oru's log.
 */
const recordToolCall = (toolCallId, name, toolArgs) => {
  const call = {
    role: 'assistant',
    content: [{ type: 'toolCall', id: toolCallId, name, arguments: toolArgs }],
    provider: model.provider,
    model: model.id,
    stopReason: 'toolUse',
  }
  event({ type: 'message_start', message: { role: 'assistant', content: [] } })
  event({ type: 'message_end', message: call })
  appendEntry('message', { message: call })
}

const recordToolResult = (toolCallId, name, text, isError) => {
  const result = {
    role: 'toolResult',
    toolCallId,
    toolName: name,
    content: [{ type: 'text', text }],
    isError,
  }
  event({ type: 'message_end', message: result })
  appendEntry('message', { message: result })
}

// ---- a scripted run ----

const assistantOf = (text, stopReason) => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  provider: model.provider,
  model: model.id,
  usage: { input: 12, output: 5, totalTokens: 17 },
  ...(stopReason === 'error'
    ? { stopReason, errorMessage: 'scripted run failure' }
    : { stopReason }),
})

const runPrompt = async (text) => {
  isStreaming = true
  messageCount += 1
  event({ type: 'agent_start' })
  event({ type: 'turn_start' })
  appendEntry('message', { message: { role: 'user', content: text } })

  if (text === '/hold') {
    const released = await new Promise((resolve) => {
      holdAbort = resolve
    })
    holdAbort = null
    const assistant = assistantOf(
      released === 'steer' ? 'Steered' : '',
      released === 'steer' ? 'stop' : 'aborted',
    )
    event({ type: 'message_end', message: assistant })
    event({ type: 'turn_end', message: assistant, toolResults: [] })
    appendEntry('message', { message: assistant })
    event({ type: 'agent_settled' })
    isStreaming = false
    return
  }

  if (text === '/die') {
    // Mid-run death without an answer: the bridge's next write hits a closed pipe.
    process.exit(0)
  }

  let toolText = ''
  const toolMatch = text.match(/^\/tool (\S+) ?(.*)$/su)
  if (toolMatch) {
    let toolArgs = {}
    try {
      toolArgs = toolMatch[2] === undefined || toolMatch[2] === '' ? {} : JSON.parse(toolMatch[2])
    } catch {
      toolArgs = { raw: toolMatch[2] }
    }
    const toolCallId = `call-${messageCount}`
    recordToolCall(toolCallId, toolMatch[1], toolArgs)
    const outcome = await runExtensionTool(toolCallId, toolMatch[1], toolArgs)
    toolText = outcome.text
    recordToolResult(toolCallId, toolMatch[1], outcome.text, outcome.isError)
  }

  const failed = text === '/fail'
  const reply = failed ? '' : toolMatch ? `Tool said: ${toolText}` : `Response to: ${text}`
  const assistant = assistantOf(reply, failed ? 'error' : 'stop')
  event({ type: 'message_start', message: { role: 'assistant', content: [] } })
  if (!failed) {
    event({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: reply, contentIndex: 0 },
      message: assistant,
    })
  }
  event({ type: 'message_end', message: assistant })
  event({ type: 'turn_end', message: assistant, toolResults: [] })
  appendEntry('message', { message: assistant })
  tokens += 17
  await emitExtensionEvent('agent_end', { messages: [assistant] })
  event({ type: 'agent_end', messages: [assistant] })
  event({ type: 'agent_settled' })
  isStreaming = false
}

// ---- commands ----

const handle = async (command) => {
  const id = command.id
  if (modeLog !== undefined) appendFileSync(modeLog, `${command.type}\n`)
  switch (command.type) {
    case 'get_state':
      respond(id, 'get_state', {
        model,
        thinkingLevel,
        isStreaming,
        isCompacting: false,
        steeringMode: 'one-at-a-time',
        followUpMode: 'one-at-a-time',
        sessionFile,
        sessionId: 'fake-session',
        autoCompactionEnabled: true,
        messageCount,
        pendingMessageCount: followUp.length,
      })
      return
    case 'get_available_models':
      respond(id, 'get_available_models', { models: MODELS })
      return
    case 'set_model': {
      const found = MODELS.find(
        (entry) => entry.provider === command.provider && entry.id === command.modelId,
      )
      if (found === undefined) {
        respondError(id, 'set_model', `Model not found: ${command.provider}/${command.modelId}`)
        return
      }
      model = found
      respond(id, 'set_model', model)
      return
    }
    case 'set_thinking_level':
      thinkingLevel = command.level
      respond(id, 'set_thinking_level')
      return
    case 'get_entries': {
      const lines =
        sessionFile === undefined ? [] : readFileSync(sessionFile, 'utf8').trim().split('\n')
      const entries = []
      for (const line of lines.slice(1)) {
        try {
          entries.push(JSON.parse(line))
        } catch {
          // Half-written line; pi's own reader skips it as well.
        }
      }
      const since = command.since
      const start = since === undefined ? 0 : entries.findIndex((entry) => entry.id === since) + 1
      respond(id, 'get_entries', {
        entries: entries.slice(start),
        leafId: entries.at(-1)?.id ?? null,
      })
      return
    }
    case 'get_session_stats':
      respond(id, 'get_session_stats', {
        sessionFile,
        sessionId: 'fake-session',
        userMessages: messageCount,
        assistantMessages: messageCount,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: messageCount * 2,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens },
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        contextUsage: { tokens, contextWindow: model.contextWindow, percent: 0 },
      })
      return
    case 'prompt': {
      if (isStreaming) {
        followUp.push(command.message)
        event({ type: 'queue_update', steering: [], followUp: [...followUp] })
        respond(id, 'prompt')
        return
      }
      respond(id, 'prompt')
      await runPrompt(command.message)
      while (followUp.length > 0) {
        event({ type: 'queue_update', steering: [], followUp: [...followUp] })
        await runPrompt(followUp.shift())
      }
      return
    }
    case 'steer':
      respond(id, 'steer')
      if (holdAbort !== null) holdAbort('steer')
      return
    case 'follow_up':
      followUp.push(command.message)
      respond(id, 'follow_up')
      return
    case 'abort':
      isStreaming = false
      if (holdAbort !== null) holdAbort('abort')
      respond(id, 'abort')
      return
    case 'compact': {
      if (messageCount === 0) {
        event({
          type: 'compaction_end',
          reason: 'manual',
          aborted: false,
          errorMessage: 'Nothing to compact (session too small)',
        })
        respondError(id, 'compact', 'Nothing to compact (session too small)')
        return
      }
      event({ type: 'compaction_start', reason: 'manual' })
      const summary = command.customInstructions ?? 'scripted summary'
      appendEntry('compaction', {
        summary,
        tokensBefore: tokens,
        details: { readFiles: ['src/a.ts'], modifiedFiles: [] },
      })
      event({ type: 'compaction_end', reason: 'manual', aborted: false })
      respond(id, 'compact', {
        summary,
        tokensBefore: tokens,
        firstKeptEntryId: leafId,
        estimatedTokensAfter: 1,
      })
      return
    }
    default:
      respondError(id, command.type, `Unknown command "${command.type}"`)
  }
}

// ---- wiring ----

const loaded = extensionPath === undefined ? Promise.resolve() : loadExtension(extensionPath)
let chain = loaded
readLines(process.stdin, (line) => {
  const trimmed = line.trim()
  if (trimmed === '') return
  let command
  try {
    command = JSON.parse(trimmed)
  } catch {
    return
  }
  // Commands that answer *while* a run is live stay out of the chain: a held
  // run never returns, so anything queued behind it would never be handled.
  if (
    command.type === 'abort' ||
    command.type === 'steer' ||
    command.type === 'get_state' ||
    command.type === 'get_entries'
  ) {
    void loaded.then(() => handle(command))
    return
  }
  chain = chain.then(() => handle(command))
})

// `agent_settled` is what the bridge waits for, and pi emits it after the run
// has finished. The fake emits it at the end of each scripted run; nothing more
// is needed here.

const exit = () => {
  process.exit(0)
}
process.stdin.on('end', exit)
process.stdin.on('close', exit)
process.on('SIGTERM', exit)
