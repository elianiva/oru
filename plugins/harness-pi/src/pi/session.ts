import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { setTimeout as sleepFor } from 'node:timers/promises'
import { Option } from 'effect'
import * as Items from '@effect-uai/core/Items'
import * as Turn from '@effect-uai/core/Turn'
import {
  HarnessLifecycle,
  type HarnessCompaction,
  type HarnessEvent,
  type HarnessForkRequest,
  type Mutable,
} from '@oru/harness'
import {
  NO_REQUEST_TIMEOUT,
  PiRpcChild,
  piChildEnv,
  resolvePiLaunch,
  type PiChannelOutgoing,
  type PiCommand,
  type PiRpcChildExitInfo,
} from './rpc-child.ts'
import { sessionFileFor, toolsFileFor, type PiPaths } from './paths.ts'
import type { PiToolBridge } from './tools.ts'
import {
  compactionOfEntry,
  failureOfEntries,
  piMessagesOfHistory,
  promptImagesOf,
  promptTextOf,
  stopReasonOfEntries,
  toolResultText,
  turnContentOf,
  usageOfEntries,
} from './translate.ts'
import {
  PiArgsEnv,
  PiCompactionResult,
  PiEntriesData,
  PiSessionHeaderLine,
  PiSessionStatsData,
  PiStateData,
  PiAgentMessage,
  decodeOption,
  type PiChannelMessage,
  type PiCompactionData,
  type PiEntry,
  type PiEventMessage,
} from './wire.ts'

/**
 * One pi thread: a `pi --mode rpc` child (ADR-0007) plus the translation
 * between its session file and oru's turn vocabulary.
 *
 * The child is spawned lazily, stays alive between turns, and keeps the
 * conversation in its own session file, and the file, not this object, is the
 * authority (ADR-0006). Everything here is promise-based node plumbing; the
 * Effect boundary is `index.ts`, where a turn becomes a `Stream`.
 */

const SPAWN_READY_TIMEOUT_MS = 30_000
const STATE_TIMEOUT_MS = 10_000
const STOP_GRACE_MS = 4_000
const STOP_KILL_MS = 4_000
const SESSION_VERSION = 3

export const NO_BUILTIN_TOOLS_ENV = 'ORU_PI_NO_BUILTIN_TOOLS'
export const SKILLS_ENV = 'ORU_PI_SKILLS'

export const delay = (ms: number): Promise<void> => sleepFor(ms, undefined, { ref: false })

/** A bridge failure with a stable code, so the runtime records why. */
export class PiBridgeError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, options: { readonly retryable?: boolean } = {}) {
    super(message)
    this.name = 'PiBridgeError'
    this.code = code
    this.retryable = options.retryable ?? false
  }
}

export interface PiRunInput {
  readonly cwd: string
  readonly history: readonly Items.HistoryItem[]
  readonly bridge: PiToolBridge
  readonly model: string | undefined
  readonly reasoning: string | undefined
  readonly instructions: string | undefined
}

export interface PiSessionDeps {
  readonly env: NodeJS.ProcessEnv
  readonly paths: PiPaths
  readonly extensionPath: string
  /** Warnings go to stderr: the bridge talks to people through oru, not around it. */
  readonly log: (message: string) => void
  /** pi resolved its own default model for this thread; the catalogue marks it. */
  readonly onDefaultModel: (modelId: string | null) => void
}

const hexId = (): string => {
  let out = ''
  for (let index = 0; index < 10; index++) {
    out += Math.floor(Math.random() * 16).toString(16)
  }
  return out
}

/** `ORU_PI_SKILLS` is a JSON array of skill paths, applied at spawn (ADR-0007). */
const skillsOf = (env: NodeJS.ProcessEnv, log: (message: string) => void): readonly string[] => {
  const raw = env[SKILLS_ENV]
  if (raw === undefined || raw.trim() === '') return []
  const parsed = decodeOption(PiArgsEnv)(raw)
  if (Option.isNone(parsed)) {
    log(`${SKILLS_ENV} must be a JSON array of paths`)
    return []
  }
  return parsed.value.filter((path) => existsSync(path))
}

/** The session header's cwd, read from the file for work that happens between turns. */
const sessionCwdOf = (file: string): string | undefined => {
  try {
    const first = readFileSync(file, 'utf8').split('\n', 1)[0] ?? ''
    const header = decodeOption(PiSessionHeaderLine)(first)
    return Option.isSome(header) ? header.value.cwd : undefined
  } catch {
    return undefined
  }
}

/**
 * Write the pi session file a thread starts from, when it has none.
 *
 * pi's own writer owns this format afterwards; this is the one place the bridge
 * writes it, so the seed is exactly what a provider can replay: a header, then
 * messages linked by `parentId` in order.
 */
const seedSessionFile = (
  file: string,
  cwd: string,
  messages: readonly unknown[],
  log: (message: string) => void,
): void => {
  if (messages.length === 0) return
  mkdirSync(dirname(file), { recursive: true })
  const started = Date.now()
  let parentId: string | null = null
  const lines: string[] = [
    JSON.stringify({
      type: 'session',
      version: SESSION_VERSION,
      id: hexId(),
      timestamp: new Date(started).toISOString(),
      cwd,
    }),
  ]
  for (const [index, message] of messages.entries()) {
    const id = hexId()
    lines.push(
      JSON.stringify({
        type: 'message',
        id,
        parentId,
        timestamp: new Date(started + index + 1).toISOString(),
        message,
      }),
    )
    parentId = id
  }
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  log(`seeded ${messages.length} message(s) into ${file}`)
}

/** The tool call a streaming event is talking about, from pi's partial message. */
const toolCallOf = (event: {
  readonly contentIndex?: number | undefined
  readonly partial?: unknown
}): { readonly id: string; readonly name: string } | undefined => {
  const index = event.contentIndex
  const partial = decodeOption(PiAgentMessage)(event.partial)
  if (index === undefined || Option.isNone(partial)) return undefined
  const block = partial.value.content?.[index]
  return block !== undefined && block.type === 'toolCall'
    ? { id: block.id, name: block.name }
    : undefined
}

/** Drop the entry that carries the prompt, which the runtime already recorded. */
const dropPromptEntry = (entries: readonly PiEntry[], prompt: string): readonly PiEntry[] => {
  const index = entries.findIndex((entry) => userTextOfEntry(entry) === prompt)
  if (index === -1) return entries
  return [...entries.slice(0, index), ...entries.slice(index + 1)]
}

const userTextOfEntry = (entry: PiEntry): string | undefined => {
  const message = decodeOption(PiAgentMessage)(entry.message)
  if (Option.isNone(message) || message.value.role !== 'user') return undefined
  return (message.value.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
}

const compactionEvent = (compaction: PiCompactionData, automatic: boolean): HarnessEvent =>
  HarnessLifecycle.CompactionEnded({
    automatic,
    summary: compaction.summary,
    tokensBefore: compaction.tokensBefore,
    readFiles: compaction.details?.readFiles ?? [],
    modifiedFiles: compaction.details?.modifiedFiles ?? [],
  })

/**
 * A thread's pi session.
 *
 * One turn at a time, like every harness: the runtime serialises turns per
 * thread, and two overlapping turns would interleave in one session file.
 */
export class PiSession {
  private child: PiRpcChild | null = null
  private fingerprint: string | null = null
  private cursor: string | null | undefined = undefined
  private ready: PromiseWithResolvers<void> | null = null
  private settled: PromiseWithResolvers<void> | null = null
  private emit: ((event: HarnessEvent) => void) | null = null
  private running = false
  private lastCwd: string | null = null
  private automaticCompactions: boolean[] = []
  private model: string | null = null
  private reasoning: string | null = null
  private toolBridge: PiToolBridge | null = null

  constructor(
    private readonly threadId: string,
    private readonly deps: PiSessionDeps,
  ) {}

  get sessionFile(): string {
    return sessionFileFor(this.deps.paths, this.threadId)
  }

  get isRunning(): boolean {
    return this.running
  }

  get liveCwd(): string | null {
    return this.lastCwd
  }

  /**
   * Run one turn and report it as it happens.
   *
   * Live events come from pi's event stream and are for a human watching; the
   * assembled turn comes from pi's session file and is what the runtime records
   * as facts. Emitting both is deliberate. They answer different questions
   * (ADR-0006, ADR-0007).
   */
  async run(input: PiRunInput, emit: (event: HarnessEvent) => void): Promise<void> {
    if (this.running) {
      throw new PiBridgeError('busy', `thread ${this.threadId} is already running a turn`)
    }
    this.running = true
    this.emit = emit
    this.toolBridge = input.bridge
    this.automaticCompactions = []
    try {
      const child = await this.ensureChild(input)
      await this.applyConfiguration(child, input)
      const prompt = promptTextOf(input.history)
      const baseline = await this.baselineCursor(child)
      if (prompt === undefined) {
        // Nothing for pi to run. The runtime asks again after a tool it ran
        // itself; failing settles the thread instead of looping forever.
        throw new PiBridgeError(
          'no_prompt',
          `thread ${this.threadId} has no user message for pi to answer`,
        )
      }
      const settled = Promise.withResolvers<void>()
      this.settled = settled
      const images = promptImagesOf(input.history)
      await child.request(
        images.length === 0
          ? { type: 'prompt', message: prompt }
          : { type: 'prompt', message: prompt, images },
        NO_REQUEST_TIMEOUT,
      )
      await settled.promise

      const entries = await this.entriesSince(child, baseline)
      const failure = failureOfEntries(entries)
      if (failure !== undefined) {
        emit(HarnessLifecycle.ProviderError({ message: failure, retryable: false }))
        throw new PiBridgeError('turn_failed', failure)
      }

      const content = turnContentOf(dropPromptEntry(entries, prompt))
      if (content.unreadable > 0) {
        emit(
          HarnessLifecycle.ProviderWarning({
            message: `pi wrote ${content.unreadable} session entr(ies) this bridge revision cannot read`,
          }),
        )
      }
      for (const compaction of content.compactions) {
        emit(compactionEvent(compaction, this.automaticCompactions.shift() ?? false))
      }
      await this.emitContextWindow(child, emit)
      emit(
        Turn.TurnEvent.TurnComplete({
          turn: {
            items: content.items,
            usage: usageOfEntries(entries),
            stop_reason: stopReasonOfEntries(entries),
          },
        }),
      )
    } finally {
      this.emit = null
      this.toolBridge = null
      this.settled = null
      this.running = false
    }
  }

  /** Inject a message into the running turn. Fails when nothing is running. */
  async steer(text: string): Promise<void> {
    const child = this.child
    if (child === null || child.exited || this.settled === null) {
      throw new PiBridgeError('not_running', `thread ${this.threadId} is not running a turn`)
    }
    await child.request({ type: 'steer', message: text })
  }

  async abort(): Promise<void> {
    const child = this.child
    if (child === null || child.exited) return
    await child.request({ type: 'abort' })
  }

  /** Compact the session pi-side and report what it kept. */
  async compact(instructions: string | undefined): Promise<HarnessCompaction> {
    const child = await this.childForOutOfTurnWork()
    const command: PiCommand =
      instructions === undefined
        ? { type: 'compact' }
        : { type: 'compact', customInstructions: instructions }
    const result = await child.requestOk(PiCompactionResult, command, NO_REQUEST_TIMEOUT)
    // The next turn starts after the compaction, so the cursor skips past it;
    // the compaction entry itself is what the file lists were recorded on.
    const entries = await child.requestOk(PiEntriesData, { type: 'get_entries' })
    this.cursor = entries.leafId
    const recorded = entries.entries
      .map((entry) => compactionOfEntry(entry))
      .filter((entry): entry is PiCompactionData => entry !== undefined)
      .at(-1)
    return {
      summary: result.summary,
      tokensBefore: result.tokensBefore,
      readFiles: recorded?.details?.readFiles ?? [],
      modifiedFiles: recorded?.details?.modifiedFiles ?? [],
    }
  }

  /** Copy this thread's session into another thread's file, inside pi. */
  async fork(request: HarnessForkRequest): Promise<void> {
    const source = this.sessionFile
    if (!existsSync(source)) {
      throw new PiBridgeError(
        'no_session',
        `thread ${request.sourceThreadId} has no pi session to fork`,
      )
    }
    const target = sessionFileFor(this.deps.paths, request.targetThreadId)
    mkdirSync(dirname(target), { recursive: true })
    const cwd = request.cwd ?? this.lastCwd ?? sessionCwdOf(source) ?? process.cwd()
    const child = await this.ensureForkChild(source, cwd)
    const outgoing: Mutable<PiChannelOutgoing> = {
      kind: 'fork',
      id: `fork-${hexId()}`,
      sourceFile: source,
      targetFile: target,
      sessionDir: this.deps.paths.sessionDir,
      cwd,
    }
    // A checkpoint is pi's own entry id; without one, pi forks at the leaf.
    if (request.checkpoint !== undefined) outgoing.checkpointId = request.checkpoint
    child.sendChannel(outgoing)
    const reply = await child.awaitChannelReply(outgoing.id, NO_REQUEST_TIMEOUT)
    if (reply.error !== undefined) {
      throw new PiBridgeError('fork_failed', `pi could not fork the session: ${reply.error}`)
    }
  }

  /** Release the child. The session file stays, so resuming is implicit. */
  async stop(): Promise<void> {
    await this.stopChild()
  }

  /** Release the child and delete what pi kept for this thread. */
  async discard(): Promise<void> {
    await this.stopChild()
    rmSync(this.sessionFile, { force: true })
    this.cursor = undefined
  }

  /** pi's own session state, for the catalogue's default marker. */
  async state(): Promise<typeof PiStateData.Type> {
    const child = await this.childForOutOfTurnWork()
    return child.requestOk(PiStateData, { type: 'get_state' }, STATE_TIMEOUT_MS)
  }

  // -------------------------------------------------------------------------
  // Child lifecycle
  // -------------------------------------------------------------------------

  private async ensureChild(input: PiRunInput): Promise<PiRpcChild> {
    const skills = skillsOf(this.deps.env, this.deps.log)
    const noBuiltinTools = this.deps.env[NO_BUILTIN_TOOLS_ENV] === '1'
    const instructionsFile = this.writeInstructions(input.instructions)
    const fingerprint = JSON.stringify({
      cwd: input.cwd,
      instructions: input.instructions ?? null,
      tools: input.bridge.tools.map((tool) => tool.name),
      skills,
      noBuiltinTools,
    })
    if (this.child !== null && !this.child.exited && this.fingerprint === fingerprint) {
      this.lastCwd = input.cwd
      return this.child
    }
    const replaced = this.child !== null
    await this.stopChild()
    if (replaced) {
      this.emit?.(
        HarnessLifecycle.SessionReplaced({
          reason: 'pi was restarted because the thread configuration changed',
        }),
      )
    }
    writeFileSync(
      toolsFileFor(this.deps.paths, this.threadId),
      JSON.stringify(input.bridge.tools),
      'utf8',
    )
    const file = this.sessionFile
    if (!existsSync(file) || statSync(file).size === 0) {
      seedSessionFile(file, input.cwd, piMessagesOfHistory(input.history), this.deps.log)
    }
    const args = [
      ...this.baseArgs(file),
      ...(instructionsFile === null ? [] : ['--append-system-prompt', instructionsFile]),
      ...(noBuiltinTools ? ['--no-builtin-tools'] : []),
      ...skills.flatMap((skill) => ['--skill', skill]),
    ]
    return this.spawnChild(args, input.cwd, fingerprint)
  }

  /** A child for work that happens between turns, on this thread's session. */
  private async childForOutOfTurnWork(): Promise<PiRpcChild> {
    const child = this.child
    if (child !== null && !child.exited) return child
    const file = this.sessionFile
    if (!existsSync(file)) {
      throw new PiBridgeError('no_session', `thread ${this.threadId} has no pi session yet`)
    }
    const cwd = this.lastCwd ?? sessionCwdOf(file) ?? process.cwd()
    return this.spawnChild(this.baseArgs(file), cwd, null)
  }

  /** A short-lived child on someone else's session, used to fork it inside pi. */
  private async ensureForkChild(sourceFile: string, cwd: string): Promise<PiRpcChild> {
    const live = this.child
    if (live !== null && !live.exited && this.sessionFile === sourceFile) return live
    return this.spawnChild(this.baseArgs(sourceFile), cwd, null)
  }

  private baseArgs(sessionFile: string): readonly string[] {
    return [
      '--mode',
      'rpc',
      '--session',
      sessionFile,
      '--session-dir',
      this.deps.paths.sessionDir,
      '--extension',
      this.deps.extensionPath,
    ]
  }

  private async spawnChild(
    args: readonly string[],
    cwd: string,
    fingerprint: string | null,
  ): Promise<PiRpcChild> {
    const ready = Promise.withResolvers<void>()
    const child = new PiRpcChild({
      cwd,
      launch: resolvePiLaunch(this.deps.env),
      env: piChildEnv(this.deps.env, {
        ORU_PI_TOOLS_FILE: toolsFileFor(this.deps.paths, this.threadId),
      }),
      args,
      onEvent: (event) => this.handleEvent(event),
      onChannelMessage: (message) => this.handleChannelMessage(message),
      onExit: (info) => this.handleExit(info, ready),
    })
    this.child = child
    this.ready = ready
    this.fingerprint = fingerprint
    this.lastCwd = cwd
    try {
      await Promise.race([
        ready.promise,
        delay(SPAWN_READY_TIMEOUT_MS).then(() => {
          throw new PiBridgeError(
            'spawn_timeout',
            `pi did not report its session within ${SPAWN_READY_TIMEOUT_MS / 1000}s`,
          )
        }),
      ])
    } catch (cause) {
      this.ready = null
      await this.stopChild()
      throw cause
    }
    return child
  }

  private handleExit(info: PiRpcChildExitInfo, ready: PromiseWithResolvers<void>): void {
    this.ready = null
    ready.reject(
      new PiBridgeError(
        'pi_exited',
        `pi exited (code ${info.code ?? 'null'}, signal ${info.signal ?? 'null'})${
          info.stderrTail === '' ? '' : `: ${info.stderrTail.trim()}`
        }`,
      ),
    )
    const settled = this.settled
    if (settled !== null) {
      this.settled = null
      settled.resolve()
    }
  }

  private async stopChild(): Promise<void> {
    const child = this.child
    this.child = null
    this.ready = null
    this.fingerprint = null
    if (child === null || child.exited) return
    child.closeGracefully()
    const ended = await Promise.race([child.waitForExit(), delay(STOP_GRACE_MS).then(() => null)])
    if (ended !== null) return
    this.deps.log(`pi (pid ${child.pid ?? '?'}) did not exit; terminating it`)
    child.kill()
    await Promise.race([child.waitForExit(), delay(STOP_KILL_MS)])
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  private async applyConfiguration(child: PiRpcChild, input: PiRunInput): Promise<void> {
    if (input.model !== undefined && input.model !== this.model) {
      const separator = input.model.indexOf('/')
      if (separator <= 0) {
        throw new PiBridgeError(
          'bad_model',
          `"${input.model}" is not a provider/model id pi accepts`,
        )
      }
      const applied = await child.request({
        type: 'set_model',
        provider: input.model.slice(0, separator),
        modelId: input.model.slice(separator + 1),
      })
      if (!applied.success) {
        throw new PiBridgeError(
          'bad_model',
          `pi rejected the model "${input.model}": ${applied.error ?? 'unknown reason'}`,
        )
      }
      this.model = input.model
    }
    if (input.reasoning !== undefined && input.reasoning !== this.reasoning) {
      const applied = await child.request({ type: 'set_thinking_level', level: input.reasoning })
      if (applied.success) {
        this.reasoning = input.reasoning
      } else {
        this.emit?.(
          HarnessLifecycle.ProviderWarning({
            message: `pi rejected the thinking level "${input.reasoning}"`,
          }),
        )
      }
    }
  }

  /** Write the thread's instructions where pi can read them as a file. */
  private writeInstructions(instructions: string | undefined): string | null {
    if (instructions === undefined || instructions.trim() === '') return null
    const file = `${toolsFileFor(this.deps.paths, this.threadId)}.instructions.md`
    writeFileSync(file, instructions, 'utf8')
    return file
  }

  private async baselineCursor(child: PiRpcChild): Promise<string | null> {
    if (this.cursor !== undefined) return this.cursor
    const entries = await child.requestOk(PiEntriesData, { type: 'get_entries' })
    this.cursor = entries.leafId
    return entries.leafId
  }

  private async entriesSince(child: PiRpcChild, since: string | null): Promise<readonly PiEntry[]> {
    const command: PiCommand =
      since === null ? { type: 'get_entries' } : { type: 'get_entries', since }
    const entries = await child.requestOk(PiEntriesData, command)
    this.cursor = entries.leafId
    return entries.entries
  }

  private async emitContextWindow(
    child: PiRpcChild,
    emit: (event: HarnessEvent) => void,
  ): Promise<void> {
    const stats = await child.requestOk(
      PiSessionStatsData,
      { type: 'get_session_stats' },
      STATE_TIMEOUT_MS,
    )
    const usage = stats.contextUsage
    if (usage === undefined || usage.tokens === null) return
    emit(
      HarnessLifecycle.ContextWindow({
        tokens: usage.tokens,
        contextWindow: usage.contextWindow,
      }),
    )
  }

  // -------------------------------------------------------------------------
  // Live events
  // -------------------------------------------------------------------------

  private handleEvent(message: PiEventMessage): void {
    const emit = this.emit
    if (emit === null) return
    if (message._tag === 'raw') {
      emit(HarnessLifecycle.RawUnhandled({ type: message.type, payload: message.raw }))
      return
    }
    const event = message.event
    switch (event.type) {
      case 'agent_settled': {
        const settled = this.settled
        this.settled = null
        settled?.resolve()
        return
      }
      case 'message_update': {
        const delta = event.assistantMessageEvent
        if (delta.type === 'text_delta' && delta.delta !== undefined) {
          emit(Turn.TurnEvent.TextDelta({ text: delta.delta }))
          return
        }
        if (delta.type === 'thinking_delta' && delta.delta !== undefined) {
          emit(Turn.TurnEvent.ReasoningDelta({ text: delta.delta, kind: 'trace' }))
          return
        }
        if (delta.type === 'toolcall_start' || delta.type === 'toolcall_delta') {
          const call = toolCallOf(delta)
          if (call === undefined) {
            emit(HarnessLifecycle.RawUnhandled({ type: delta.type, payload: '{}' }))
            return
          }
          if (delta.type === 'toolcall_start') {
            emit(Turn.TurnEvent.ToolCallStart({ call_id: call.id, name: call.name }))
          } else if (delta.delta !== undefined) {
            emit(Turn.TurnEvent.ToolCallArgsDelta({ call_id: call.id, delta: delta.delta }))
          }
          return
        }
        emit(HarnessLifecycle.RawUnhandled({ type: delta.type, payload: '{}' }))
        return
      }
      case 'tool_execution_start': {
        emit(
          Turn.TurnEvent.ToolCallStart({
            call_id: event.toolCallId,
            name: event.toolName,
          }),
        )
        return
      }
      case 'tool_execution_end': {
        // pi ran this call itself, built-in or forwarded: the runtime records
        // the outcome as a fact, and whether it failed is only known here
        // (ADR-0007).
        emit(
          HarnessLifecycle.ToolResult({
            call_id: event.toolCallId,
            name: event.toolName,
            ok: event.isError !== true,
            result: toolResultText(event.result),
          }),
        )
        return
      }
      case 'compaction_start': {
        const automatic = event.reason !== 'manual'
        this.automaticCompactions.push(automatic)
        emit(HarnessLifecycle.CompactionStarted({ automatic }))
        return
      }
      case 'compaction_end': {
        if (event.errorMessage !== undefined) {
          emit(HarnessLifecycle.ProviderWarning({ message: event.errorMessage }))
        }
        return
      }
      case 'auto_retry_start': {
        emit(
          HarnessLifecycle.ProviderWarning({
            message: `pi is retrying after an error: ${event.errorMessage ?? 'unknown error'}`,
          }),
        )
        return
      }
      case 'auto_retry_end': {
        if (event.success !== true) {
          emit(
            HarnessLifecycle.ProviderError({
              message: event.finalError ?? 'pi gave up retrying',
              retryable: false,
            }),
          )
        }
        return
      }
      case 'extension_error': {
        emit(
          HarnessLifecycle.ProviderWarning({
            message: `a pi extension failed on ${event.event ?? 'an event'}: ${
              event.error ?? 'unknown error'
            }`,
          }),
        )
        return
      }
      default:
        // Understood, and nothing oru records: turn boundaries, entry appends,
        // queue updates, tool output progress.
        return
    }
  }

  private handleChannelMessage(message: PiChannelMessage): void {
    if (message.kind === 'tool-call') {
      void this.answerToolCall(message.id, message.toolName, message.arguments ?? '{}')
      return
    }
    if (message.kind === 'model-scope') {
      this.deps.onDefaultModel(message.defaultModelId)
      return
    }
    if (message.kind === 'ready') {
      const ready = this.ready
      this.ready = null
      ready?.resolve()
      return
    }
    // `leaf` marks a run's checkpoint, and `reply` answers a fork; both are
    // consumed where they are awaited.
  }

  private async answerToolCall(id: string, name: string, argumentsJson: string): Promise<void> {
    const bridge = this.toolBridge
    const child = this.child
    if (bridge === null) {
      child?.sendChannel({
        kind: 'tool-result',
        id,
        text: JSON.stringify({
          error: { kind: 'no_toolkit', message: `no toolkit is bound for thread ${this.threadId}` },
        }),
        isError: true,
      })
      return
    }
    const outcome = await bridge.run(name, argumentsJson, (callId, delta) => {
      this.emit?.(Turn.TurnEvent.ToolCallArgsDelta({ call_id: callId, delta }))
    })
    child?.sendChannel({
      kind: 'tool-result',
      id,
      text: outcome.text,
      isError: outcome.isError,
    })
  }
}
