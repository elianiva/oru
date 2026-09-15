import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Data, Option, Schema } from 'effect'

class ScriptedRequestTimeout extends Data.TaggedError('ScriptedRequestTimeout')<{
  readonly seen: number
  readonly wanted: number
}> {}

/**
 * A scripted model provider for hermetic bridge tests.
 *
 * pi talks to it the way it talks to any OpenAI-compatible endpoint declared
 * in `models.json`, so everything the bridge depends on stays real: the pi
 * process, its RPC dialect, its session file, the injected extension, and the
 * tool channel. Only the model is scripted — its answers, and nothing else,
 * come from here.
 *
 * Scripted prompts (the last user message decides; a trailing tool result
 * always answers the tool call first):
 *   `<text>`                one assistant turn, `Response to: <text>`
 *   `/tool <name> <json>`   the model calls the named tool first, then answers with its text
 *   `/fail`                 the provider fails the call, as a provider outage does
 *   `/hold`                 a response that stays open until pi lets go of it
 *   `/slow`                 a response that streams slowly, so a steer can land mid-turn
 *   `/large-context`        a turn big enough for pi to consider compacting
 * A summarization request (pi's compaction prompt) answers `Scripted summary`.
 */

export const SCRIPTED_PROVIDER = 'scripted'
export const SCRIPTED_MODEL = 'scripted/scripted-model'
export const SCRIPTED_MINI = 'scripted/scripted-mini'

/** The vendored pi this package ships: the tests drive a real binary, not a reimplementation. */
export const PI_CLI = fileURLToPath(
  new URL('../node_modules/@earendil-works/pi-coding-agent/dist/cli.js', import.meta.url),
)

const USAGE = { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }

interface ScriptedMessage {
  readonly role: string
  readonly content: typeof ScriptedContent.Type
}

export interface ScriptedFunctionTool {
  readonly name: string
  readonly description: unknown
  readonly parameters: unknown
}

export interface ScriptedRequest {
  readonly model: unknown
  readonly messages: readonly ScriptedMessage[]
  readonly tools: readonly ScriptedFunctionTool[]
}

export interface ScriptedProvider {
  readonly dir: string
  readonly env: NodeJS.ProcessEnv
  readonly requests: readonly ScriptedRequest[]
  waitForRequests(count: number): Promise<void>
  toolsOfLastRequest(): readonly ScriptedFunctionTool[]
  close(): Promise<void>
}

export interface StartScriptedProviderOptions {
  /** Answer `pi --version` with this instead of the vendored pi's own. */
  readonly piVersion?: string | undefined
}

/**
 * The child's environment must be hermetic: an ambient `OPENAI_API_KEY` in the
 * developer's shell would make pi list providers this suite did not declare.
 */
const cleanEnv = (overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv => {
  const credential = /(_API_KEY|_TOKEN|_ACCESS_KEY|_SECRET|_CREDENTIALS)$/u
  const explicit = new Set([
    'AWS_PROFILE',
    'AWS_ACCESS_KEY_ID',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'PI_CODING_AGENT_DIR',
    'PI_PACKAGE_DIR',
  ])
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (credential.test(key) || explicit.has(key)) continue
    if (key.startsWith('ORU_PI_')) continue
    env[key] = value
  }
  return { ...env, ...overrides }
}

/**
 * The request body, parsed at the boundary: pi's object is the wire format,
 * and everything past this point branches on these domain values.
 */
const ScriptedTextPart = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
})
const ScriptedContent = Schema.Union([Schema.String, Schema.Array(ScriptedTextPart), Schema.Null])
const ScriptedMessageBody = Schema.Struct({
  role: Schema.String,
  content: ScriptedContent,
})
const ScriptedToolBody = Schema.Struct({
  type: Schema.String,
  function: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.Unknown),
      parameters: Schema.optionalKey(Schema.Unknown),
    }),
  ),
})
const ScriptedRequestBody = Schema.Struct({
  model: Schema.optionalKey(Schema.Unknown),
  messages: Schema.optionalKey(Schema.Array(ScriptedMessageBody)),
  tools: Schema.optionalKey(Schema.Array(ScriptedToolBody)),
})

/** `Schema.decodeUnknownOption`, aliased the way the bridge aliases it. */
const decodeOption = Schema.decodeUnknownOption

const textOfContent = (content: typeof ScriptedContent.Type): string => {
  const text = decodeOption(Schema.String)(content)
  if (Option.isSome(text)) return text.value
  const parts = decodeOption(Schema.Array(ScriptedTextPart))(content)
  if (Option.isNone(parts)) return ''
  return parts.value.map((part) => part.text ?? '').join('')
}

const toMessage = (body: typeof ScriptedMessageBody.Type): ScriptedMessage => ({
  role: body.role,
  content: body.content,
})

const toTool = (body: typeof ScriptedToolBody.Type): readonly ScriptedFunctionTool[] => {
  const { type, function: fn } = body
  if (type !== 'function' || fn === undefined) return []
  return [{ name: fn.name, description: fn.description, parameters: fn.parameters }]
}

const toRequest = (body: typeof ScriptedRequestBody.Type): ScriptedRequest => ({
  model: body.model,
  messages: (body.messages ?? []).map(toMessage),
  tools: (body.tools ?? []).flatMap(toTool),
})

const readBody = (request: IncomingMessage): Promise<string> => {
  const settled = Promise.withResolvers<string>()
  let text = ''
  request.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
  })
  request.on('end', () => settled.resolve(text))
  request.on('error', settled.reject)
  return settled.promise
}

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
} as const

interface ScriptedToolCallDelta {
  readonly index: number
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

/** Every delta this provider ever sends, so the writer takes no open shape. */
type ScriptedDelta =
  | { readonly role: 'assistant'; readonly content: string }
  | { readonly content: string }
  | { readonly role: 'assistant'; readonly tool_calls: readonly ScriptedToolCallDelta[] }
  | { readonly [key: string]: never }

const writeChunk = (
  response: ServerResponse,
  delta: ScriptedDelta,
  finishReason: string | null,
): void => {
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-scripted',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'scripted-model',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`,
  )
}

const writeUsage = (response: ServerResponse): void => {
  response.write(
    `data: ${JSON.stringify({
      id: 'chatcmpl-scripted',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'scripted-model',
      choices: [],
      usage: USAGE,
    })}\n\n`,
  )
}

const endStream = (response: ServerResponse): void => {
  response.write('data: [DONE]\n\n')
  response.end()
}

const sendText = (response: ServerResponse, text: string): void => {
  response.writeHead(200, SSE_HEADERS)
  const middle = Math.max(1, Math.floor(text.length / 2))
  writeChunk(response, { role: 'assistant', content: text.slice(0, middle) }, null)
  writeChunk(response, { content: text.slice(middle) }, null)
  writeChunk(response, {}, 'stop')
  writeUsage(response)
  endStream(response)
}

const sendToolCall = (
  response: ServerResponse,
  callId: string,
  name: string,
  argsJson: string,
): void => {
  response.writeHead(200, SSE_HEADERS)
  writeChunk(
    response,
    {
      role: 'assistant',
      tool_calls: [
        { index: 0, id: callId, type: 'function', function: { name, arguments: argsJson } },
      ],
    },
    null,
  )
  writeChunk(response, {}, 'tool_calls')
  writeUsage(response)
  endStream(response)
}

const sleep = (ms: number): Promise<void> => {
  const settled = Promise.withResolvers<void>()
  setTimeout(() => settled.resolve(), ms)
  return settled.promise
}

/**
 * A response that stays open long enough to steer mid-turn: pi queues the
 * steer and delivers it after this assistant message finishes, before the
 * next model call.
 */
const streamSlowly = async (response: ServerResponse): Promise<void> => {
  response.writeHead(200, SSE_HEADERS)
  const text = 'Slow answer streaming.'
  const step = 4
  for (let index = 0; index < text.length; index += step) {
    if (response.destroyed || response.writableEnded) return
    writeChunk(
      response,
      index === 0
        ? { role: 'assistant', content: text.slice(index, index + step) }
        : { content: text.slice(index, index + step) },
      null,
    )
    await sleep(150)
  }
  if (response.destroyed || response.writableEnded) return
  writeChunk(response, {}, 'stop')
  writeUsage(response)
  endStream(response)
}

const sendFailure = (response: ServerResponse): void => {
  response.writeHead(400, { 'content-type': 'application/json' })
  response.end(
    JSON.stringify({
      error: {
        message: 'scripted run failure',
        type: 'invalid_request_error',
        code: 'scripted',
      },
    }),
  )
}

export const startScriptedProvider = async (
  options: StartScriptedProviderOptions = {},
): Promise<ScriptedProvider> => {
  const dir = mkdtempSync(join(tmpdir(), 'oru-pi-scripted-'))
  const configDir = join(dir, 'agent')
  const sessionsDir = join(dir, 'sessions')
  mkdirSync(configDir, { recursive: true })
  mkdirSync(sessionsDir, { recursive: true })

  const requests: ScriptedRequest[] = []
  const woken: Array<() => void> = []
  const held = new Set<ServerResponse>()
  let callSeq = 0
  let server: Server | undefined

  const wake = (): void => {
    for (const notify of woken.splice(0)) notify()
  }

  const answer = (request: ScriptedRequest, response: ServerResponse): void => {
    const system = request.messages
      .filter((message) => message.role === 'system' || message.role === 'developer')
      .map((message) => textOfContent(message.content))
      .join('\n')
    const last = request.messages.at(-1)
    const userTexts = request.messages
      .filter((message) => message.role === 'user')
      .map((message) => textOfContent(message.content))
    const prompt = userTexts.at(-1) ?? ''

    // pi's compaction prompt is a summarization request, not a turn: it asks
    // for a summary of the conversation it sends, with the caller's focus.
    if (
      system.includes('context summarization assistant') &&
      userTexts.some((text) => text.includes('</conversation>'))
    ) {
      const focus = /Additional focus: ([^\n]+)/u.exec(prompt)?.[1]
      sendText(
        response,
        focus === undefined ? 'Scripted summary.' : `Scripted summary (focus: ${focus}).`,
      )
      return
    }

    // A tool result always answers the call that produced it: this is the
    // model's second turn of the loop pi runs, not a new scripted prompt.
    if (last !== undefined && last.role === 'tool') {
      sendText(response, `Tool said: ${textOfContent(last.content)}`)
      return
    }

    const tool = /^\/tool (\S+) ?(.*)$/su.exec(prompt)
    if (tool !== null && tool[1] !== undefined) {
      let argsJson = tool[2] ?? ''
      try {
        argsJson = JSON.stringify(argsJson === '' ? {} : JSON.parse(argsJson))
      } catch {
        argsJson = JSON.stringify({ raw: argsJson })
      }
      callSeq += 1
      sendToolCall(response, `call-${callSeq}`, tool[1], argsJson)
      return
    }

    if (prompt === '/fail') {
      sendFailure(response)
      return
    }

    if (prompt === '/hold') {
      held.add(response)
      return
    }

    if (prompt === '/slow') {
      void streamSlowly(response)
      return
    }

    // One turn of this is half of what pi keeps through a compaction, so two of
    // them leave an older turn for pi to summarize.
    if (prompt === '/large-context') {
      sendText(response, 'oru large context filler sentence. '.repeat(1500))
      return
    }

    sendText(response, `Response to: ${prompt}`)
  }

  const created = createServer((incoming: IncomingMessage, outgoing: ServerResponse) => {
    if (incoming.method !== 'POST') {
      outgoing.writeHead(404).end()
      return
    }
    void readBody(incoming).then(
      (raw) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          outgoing.writeHead(400).end()
          return
        }
        const body = decodeOption(ScriptedRequestBody)(parsed)
        if (Option.isNone(body)) {
          outgoing.writeHead(400).end()
          return
        }
        const request = toRequest(body.value)
        requests.push(request)
        wake()
        answer(request, outgoing)
      },
      () => undefined,
    )
    const drop = (): void => {
      held.delete(outgoing)
    }
    incoming.on('close', drop)
    outgoing.on('close', drop)
  })
  const listening = Promise.withResolvers<void>()
  created.on('error', (cause) => listening.reject(cause))
  created.listen(0, '127.0.0.1', () => listening.resolve())
  await listening.promise
  server = created
  // SAFETY: the server listens on 127.0.0.1, so once the listening callback
  // ran, address() is a bound TCP AddressInfo — never a pipe string or null.
  const port = (server.address() as AddressInfo).port

  writeFileSync(
    join(configDir, 'models.json'),
    JSON.stringify({
      providers: {
        [SCRIPTED_PROVIDER]: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: 'openai-completions',
          apiKey: 'scripted-test-key',
          compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
          models: [
            {
              id: 'scripted-model',
              name: 'Scripted Model',
              reasoning: true,
              input: ['text'],
              contextWindow: 200_000,
              maxTokens: 8192,
            },
            {
              id: 'scripted-mini',
              name: 'Scripted Mini',
              reasoning: false,
              input: ['text'],
              contextWindow: 32_000,
              maxTokens: 8192,
            },
          ],
        },
      },
    }),
    'utf8',
  )
  writeFileSync(
    join(configDir, 'settings.json'),
    JSON.stringify({ defaultProvider: SCRIPTED_PROVIDER, defaultModel: 'scripted-model' }),
    'utf8',
  )

  let packageDir: string | undefined
  if (options.piVersion !== undefined) {
    packageDir = join(dir, 'package')
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({ name: '@earendil-works/pi-coding-agent', version: options.piVersion }),
      'utf8',
    )
  }

  const env = cleanEnv({
    PI_CODING_AGENT_DIR: configDir,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
    ORU_PI_COMMAND: process.execPath,
    ORU_PI_ARGS: JSON.stringify([PI_CLI]),
    ORU_PI_SESSION_DIR: sessionsDir,
  })
  if (packageDir !== undefined) {
    env.PI_PACKAGE_DIR = packageDir
  }

  const waitForRequests = (count: number): Promise<void> => {
    const settled = Promise.withResolvers<void>()
    const timer = setTimeout(() => {
      remove()
      settled.reject(new ScriptedRequestTimeout({ seen: requests.length, wanted: count }))
    }, 10_000)
    const check = (): void => {
      if (requests.length >= count) {
        remove()
        settled.resolve()
      }
    }
    const remove = (): void => {
      clearTimeout(timer)
      const index = woken.indexOf(check)
      if (index !== -1) woken.splice(index, 1)
    }
    woken.push(check)
    check()
    return settled.promise
  }

  const toolsOfLastRequest = (): readonly ScriptedFunctionTool[] => requests.at(-1)?.tools ?? []

  const close = (): Promise<void> => {
    const settled = Promise.withResolvers<void>()
    for (const response of held) response.destroy()
    held.clear()
    server?.close((error) => {
      if (error instanceof Error) settled.reject(error)
      else settled.resolve()
    })
    return settled.promise
  }

  return { dir, env, requests, waitForRequests, toolsOfLastRequest, close }
}
