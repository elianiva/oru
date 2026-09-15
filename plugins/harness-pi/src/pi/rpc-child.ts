import { spawn, type ChildProcess } from 'node:child_process'
import { Option, Schema } from 'effect'
import { Readable, Writable } from 'node:stream'
import { attachJsonlLineReader, serializeJsonLine } from './jsonl.ts'
import type { PiLaunch } from './maintenance.ts'
import {
  PI_DIALOG_METHODS,
  PiArgsEnv,
  PiChannelLine,
  PiEventLine,
  PiEventSeen,
  PiRawLineSeen,
  PiResponseLine,
  PiTypedLineReader,
  PiUiRequestLine,
  decodeOption,
  type PiChannelMessage,
  type PiImageBlock,
  type PiChannelReply,
  type PiEventMessage,
  type PiResponseEnvelope,
} from './wire.ts'

export const PI_COMMAND_ENV = 'ORU_PI_COMMAND'
export const PI_ARGS_ENV = 'ORU_PI_ARGS'

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
export const NO_REQUEST_TIMEOUT = 0
const STDERR_TAIL_BYTES = 4_096
const SIGTERM_GRACE_MS = 4_000
const SIGKILL_ESCALATION_MS = 4_000

/** Fd the injected extension writes on; it reads on `BRIDGE_TO_CHILD_FD`. */
const CHILD_TO_BRIDGE_FD = 3
const BRIDGE_TO_CHILD_FD = 4

export interface PiRpcChildExitInfo {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderrTail: string
  readonly beforeFirstResponse: boolean
}

export class PiRpcError extends Schema.TaggedError<PiRpcError>()('PiRpcError', {
  message: Schema.String,
}) {}

export class PiRpcChildExited extends Schema.TaggedError<PiRpcChildExited>()('PiRpcChildExited', {
  message: Schema.String,
  info: Schema.Struct({
    code: Schema.NullOr(Schema.Number),
    signal: Schema.NullOr(Schema.String),
    stderrTail: Schema.String,
    beforeFirstResponse: Schema.Boolean,
  }),
}) {}

const childExited = (info: PiRpcChildExitInfo) =>
  new PiRpcChildExited({
    info,
    message: `pi exited (code ${info.code ?? 'null'}, signal ${info.signal ?? 'null'})${
      info.stderrTail === '' ? '' : `: ${info.stderrTail.trim()}`
    }`,
  })

/** The RPC commands this bridge sends. pi's own list is wider; this is the used set. */
export type PiCommand =
  | {
      readonly type: 'prompt'
      readonly message: string
      readonly images?: readonly PiImageBlock[]
      readonly streamingBehavior?: 'steer' | 'followUp'
    }
  | { readonly type: 'steer'; readonly message: string }
  | { readonly type: 'follow_up'; readonly message: string }
  | { readonly type: 'abort' }
  | { readonly type: 'clear_queue' }
  | { readonly type: 'compact'; readonly customInstructions?: string }
  | { readonly type: 'get_state' }
  | { readonly type: 'get_available_models' }
  | { readonly type: 'get_entries'; readonly since?: string }
  | { readonly type: 'get_session_stats' }
  | { readonly type: 'set_model'; readonly provider: string; readonly modelId: string }
  | { readonly type: 'set_thinking_level'; readonly level: string }
  | { readonly type: 'set_steering_mode'; readonly mode: 'all' | 'one-at-a-time' }
  | { readonly type: 'set_follow_up_mode'; readonly mode: 'all' | 'one-at-a-time' }
  | { readonly type: 'set_auto_compaction'; readonly enabled: boolean }

/** What the bridge sends down the extension channel. */
export type PiChannelOutgoing =
  | {
      readonly kind: 'tool-result'
      readonly id: string
      readonly text: string
      readonly isError: boolean
    }
  | {
      readonly kind: 'fork'
      readonly id: string
      readonly sourceFile: string
      readonly targetFile: string
      readonly sessionDir: string
      readonly cwd: string
      readonly checkpointId?: string
    }

export interface SpawnPiRpcChildArgs {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  /** How to launch pi, resolved from this bridge's environment (never the ambient one). */
  readonly launch: { readonly command: string; readonly args: readonly string[] }
  readonly args: readonly string[]
  readonly onEvent: (event: PiEventMessage) => void
  readonly onChannelMessage: (message: PiChannelMessage) => void
  readonly onExit: (info: PiRpcChildExitInfo) => void
}

interface PendingRequest {
  readonly resolve: (response: PiResponseEnvelope) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout | null
}

interface PendingReply {
  readonly resolve: (reply: PiChannelReply) => void
  readonly timer: NodeJS.Timeout | null
}

/** `ORU_PI_COMMAND` / `ORU_PI_ARGS` point the bridge at a pi that is not on `PATH`. */
export const resolvePiLaunch = (env: NodeJS.ProcessEnv): PiLaunch => {
  const command = env[PI_COMMAND_ENV]
  if (command === undefined || command === '') return { command: 'pi', args: [] }
  const rawArgs = env[PI_ARGS_ENV]
  if (rawArgs === undefined || rawArgs === '') return { command, args: [] }
  const parsed = decodeOption(PiArgsEnv)(rawArgs)
  if (Option.isNone(parsed)) {
    throw new PiRpcError({ message: `${PI_ARGS_ENV} must be a JSON array of strings` })
  }
  return { command, args: parsed.value }
}

/**
 * The child's environment: everything the host has, minus the two variables
 * that would otherwise point a nested oru at the wrong pi.
 */
export const piChildEnv = (
  base: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...base, ...overrides }
  delete env[PI_COMMAND_ENV]
  delete env[PI_ARGS_ENV]
  return env
}

/**
 * One `pi --mode rpc` process, with the extension channel wired alongside it.
 *
 * Two transports, both JSONL: pi's own stdin/stdout for the RPC protocol, and
 * a pair of extra descriptors for the injected extension. The extension cannot
 * use stdout (that is the protocol) and cannot use stdin without racing the
 * bridge, so it gets fds 3 and 4.
 */
export class PiRpcChild {
  readonly child: ChildProcess
  private readonly pending = new Map<string, PendingRequest>()
  private readonly replies = new Map<string, PendingReply>()
  private nextRequestId = 0
  private stderrTail = ''
  private sawResponse = false
  private exitInfo: PiRpcChildExitInfo | null = null
  private readonly exit: Promise<PiRpcChildExitInfo>
  private readonly channelWriter: Writable | null
  private killEscalation: NodeJS.Timeout | null = null
  private readonly args: SpawnPiRpcChildArgs

  constructor(args: SpawnPiRpcChildArgs) {
    this.args = args
    const settled = Promise.withResolvers<PiRpcChildExitInfo>()
    this.exit = settled.promise

    const launch = args.launch
    this.child = spawn(launch.command, [...launch.args, ...args.args], {
      cwd: args.cwd,
      env: args.env,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
    })

    const stdout = this.child.stdout
    const stderr = this.child.stderr
    const channelIn = this.child.stdio[CHILD_TO_BRIDGE_FD]
    const channelOut = this.child.stdio[BRIDGE_TO_CHILD_FD]
    // Which end of the pair each descriptor is depends on the spawn: a piped
    // child gets a `Readable` on the end it writes and a `Writable` on the end
    // it reads. Anything else means the spawn was misconfigured, and the
    // extension channel is simply not there.
    this.channelWriter = channelOut instanceof Writable ? channelOut : null
    this.child.stdin?.on('error', () => undefined)
    this.channelWriter?.on('error', () => undefined)

    if (stdout !== null) {
      attachJsonlLineReader(stdout, (line) => this.handleStdoutLine(line), {
        onOverflow: (bytes) => this.warn(`dropped a ${bytes}-byte stdout line`),
      })
    }
    if (stderr !== null) {
      stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_BYTES)
        process.stderr.write(`pi[${String(this.child.pid ?? '?')}]: ${text}`)
      })
    }
    if (channelIn instanceof Readable) {
      attachJsonlLineReader(channelIn, (line) => this.handleChannelLine(line), {
        onOverflow: (bytes) => this.warn(`dropped a ${bytes}-byte channel line`),
      })
    }

    const settle = (code: number | null, signal: NodeJS.Signals | null) => {
      if (this.exitInfo !== null) return
      if (this.killEscalation !== null) {
        clearTimeout(this.killEscalation)
        this.killEscalation = null
      }
      const info: PiRpcChildExitInfo = {
        code,
        signal,
        stderrTail: this.stderrTail,
        beforeFirstResponse: !this.sawResponse,
      }
      this.exitInfo = info
      settled.resolve(info)
      for (const request of this.pending.values()) {
        if (request.timer !== null) clearTimeout(request.timer)
        request.reject(childExited(info))
      }
      this.pending.clear()
      for (const reply of this.replies.values()) {
        if (reply.timer !== null) clearTimeout(reply.timer)
        reply.resolve({ kind: 'reply', id: '', error: childExited(info).message })
      }
      this.replies.clear()
      args.onExit(info)
    }

    this.child.on('error', (error) => {
      this.stderrTail = `${this.stderrTail}${error.message}`
    })
    this.child.on('exit', settle)
    this.child.on('close', (code, signal) => settle(code, signal))
  }

  get exited(): boolean {
    return this.exitInfo !== null
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  get stderr(): string {
    return this.stderrTail
  }

  waitForExit(): Promise<PiRpcChildExitInfo> {
    return this.exit
  }

  request(
    command: PiCommand,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<PiResponseEnvelope> {
    const info = this.exitInfo
    if (info !== null) return Promise.reject(childExited(info))
    this.nextRequestId += 1
    const id = `oru-${this.nextRequestId}`
    const deferred = Promise.withResolvers<PiResponseEnvelope>()
    const timer =
      timeoutMs === NO_REQUEST_TIMEOUT
        ? null
        : setTimeout(() => {
            this.pending.delete(id)
            deferred.reject(
              new PiRpcError({ message: `pi did not answer ${command.type} in time` }),
            )
          }, timeoutMs)
    timer?.unref?.()
    this.pending.set(id, { resolve: deferred.resolve, reject: deferred.reject, timer })
    this.writeStdin(serializeJsonLine({ ...command, id }))
    return deferred.promise
  }

  /** Send a command and decode its payload, failing on `success: false`. */
  async requestOk<A>(
    schema: Schema.ConstraintDecoder<A, never>,
    command: PiCommand,
    timeoutMs?: number,
  ): Promise<A> {
    const response = await this.request(command, timeoutMs)
    if (!response.success) {
      throw new PiRpcError({ message: response.error ?? `pi rejected ${command.type}` })
    }
    if (response.data === undefined) {
      throw new PiRpcError({ message: `pi answered ${command.type} without a payload` })
    }
    const decoded = decodeOption(schema)(response.data)
    if (Option.isNone(decoded)) {
      throw new PiRpcError({
        message: `pi answered ${command.type} with a payload oru cannot read`,
      })
    }
    return decoded.value
  }

  sendChannel(message: PiChannelOutgoing): void {
    const writer = this.channelWriter
    if (writer === null || writer.destroyed || writer.writableEnded) return
    writer.write(serializeJsonLine(message))
  }

  /**
   * Wait for the extension's answer to a channel message it must reply to.
   * Fails when the child goes away first, so a fork never hangs on a dead pi.
   */
  awaitChannelReply(
    id: string,
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<PiChannelReply> {
    const info = this.exitInfo
    if (info !== null) return Promise.reject(childExited(info))
    const deferred = Promise.withResolvers<PiChannelReply>()
    const timer =
      timeoutMs === NO_REQUEST_TIMEOUT
        ? null
        : setTimeout(() => {
            this.replies.delete(id)
            deferred.reject(
              new PiRpcError({ message: `pi did not answer the channel message ${id} in time` }),
            )
          }, timeoutMs)
    timer?.unref?.()
    this.replies.set(id, { resolve: deferred.resolve, timer })
    return deferred.promise
  }

  /** Stop without dropping the conversation: close the pipes, then escalate. */
  closeGracefully(): void {
    if (this.exitInfo !== null) return
    this.endWriters()
    const timer = setTimeout(() => {
      if (this.exitInfo === null) this.kill()
    }, SIGTERM_GRACE_MS)
    timer.unref?.()
  }

  kill(): void {
    if (this.exitInfo !== null) return
    this.endWriters()
    if (this.killEscalation === null) {
      this.killEscalation = setTimeout(() => {
        this.killEscalation = null
        if (this.exitInfo === null) this.child.kill('SIGKILL')
      }, SIGKILL_ESCALATION_MS)
      this.killEscalation.unref?.()
    }
    this.child.kill('SIGTERM')
  }

  private warn(message: string): void {
    process.stderr.write(`oru harness-pi: ${message}\n`)
  }

  private endWriters(): void {
    const stdin = this.child.stdin
    if (stdin !== null && !stdin.destroyed && !stdin.writableEnded) stdin.end()
    const writer = this.channelWriter
    if (writer !== null && !writer.destroyed && !writer.writableEnded) writer.end()
  }

  private writeStdin(line: string): void {
    const stdin = this.child.stdin
    if (stdin === null || stdin.destroyed) return
    stdin.write(line)
  }

  private handleStdoutLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    const response = decodeOption(PiResponseLine)(trimmed)
    if (Option.isSome(response)) {
      this.handleResponse(response.value)
      return
    }
    const ui = decodeOption(PiUiRequestLine)(trimmed)
    if (Option.isSome(ui)) {
      // pi blocks on a dialog until it gets an answer, and there is no one to
      // answer it here: cancel every dialog rather than hang the turn.
      if (PI_DIALOG_METHODS.includes(ui.value.method)) {
        this.writeStdin(
          serializeJsonLine({
            type: 'extension_ui_response',
            id: ui.value.id,
            cancelled: true,
          }),
        )
        return
      }
      // notify/setStatus/setWidget/setTitle/set_editor_text are one-way: they
      // exist for a TUI pi is not running under, so they are reported, not sent back.
      this.warn(`pi asked for a UI update (${ui.value.method}); oru has no pi UI`)
      return
    }
    const event = decodeOption(PiEventLine)(trimmed)
    if (Option.isSome(event)) {
      this.args.onEvent(PiEventSeen.make({ event: event.value }))
      return
    }
    const typed = decodeOption(PiTypedLineReader)(trimmed)
    if (Option.isSome(typed)) {
      this.args.onEvent(PiRawLineSeen.make({ type: typed.value.type, raw: trimmed }))
      return
    }
    this.warn(`ignored an unreadable stdout line (${trimmed.length} bytes)`)
  }

  private handleResponse(message: PiResponseEnvelope): void {
    this.sawResponse = true
    const id = message.id
    const request = id === undefined ? undefined : this.pending.get(id)
    if (request === undefined || id === undefined) return
    this.pending.delete(id)
    if (request.timer !== null) clearTimeout(request.timer)
    request.resolve(message)
  }

  private handleChannelLine(line: string): void {
    const trimmed = line.trim()
    if (trimmed === '') return
    const decoded = decodeOption(PiChannelLine)(trimmed)
    if (Option.isNone(decoded)) {
      this.warn(`ignored an unreadable channel line (${trimmed.length} bytes)`)
      return
    }
    const message = decoded.value
    if (message.kind === 'reply') {
      const waiting = this.replies.get(message.id)
      if (waiting === undefined) return
      this.replies.delete(message.id)
      if (waiting.timer !== null) clearTimeout(waiting.timer)
      waiting.resolve(message)
      return
    }
    this.args.onChannelMessage(message)
  }
}

export type { PiChannelMessage, PiEventMessage }
