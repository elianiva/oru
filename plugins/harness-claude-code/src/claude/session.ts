import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Option, Schema } from 'effect'
import {
  HarnessEvent,
  assistantText,
  type HarnessForkRequest,
  type HistoryItem,
  type TurnUsage,
} from '@oru/harness'
import { CLAUDE_ARGS_ENV, CLAUDE_COMMAND_ENV, type ClaudeLaunch } from './launch.ts'
import { mapFileFor, type ClaudePaths } from './paths.ts'
import { historyToPrompt, isResumeUnknown, latestUserText, translateLine } from './translate.ts'

/**
 * One Muse thread: a one-shot `claude -p` child per turn plus the
 * thread-to-session pointer that makes `--resume` work.
 *
 * The CLI owns the conversation (its own session, compaction, steering) and
 * oru owns the record and the turn boundary. Nothing here installs, signs in,
 * or repairs the CLI; it reports what it finds (ADR-0007). Everything here is
 * promise-based node plumbing; the Effect boundary is `plugin.ts`, where a
 * turn becomes a `Stream`.
 */

const STDERR_TAIL_BYTES = 4_096
const SIGKILL_ESCALATION_MS = 4_000

/** A bridge failure with a stable code, so the runtime records why. */
export class ClaudeBridgeError extends Schema.TaggedError<ClaudeBridgeError>()(
  'ClaudeBridgeError',
  {
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}

export interface ClaudeRunInput {
  readonly cwd: string
  readonly history: readonly HistoryItem[]
  readonly model: string | undefined
  readonly instructions: string | undefined
}

export interface ClaudeSessionDeps {
  readonly env: NodeJS.ProcessEnv
  readonly paths: ClaudePaths
  readonly launch: ClaudeLaunch
  readonly defaultModel: string
  /** Warnings go to stderr: the bridge talks to people through oru, not around it. */
  readonly log: (message: string) => void
}

const decodeOption = Schema.decodeUnknownOption

const ThreadMapping = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
})

interface TurnAttempt {
  readonly prompt: string
  readonly model: string | undefined
  readonly instructions: string | undefined
  readonly resumeId: string | undefined
  readonly cwd: string
}

/**
 * The child's environment: everything the host has, minus the two variables
 * that would otherwise point a nested oru at the wrong `claude`.
 */
const claudeChildEnv = (base: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...base }
  delete env[CLAUDE_COMMAND_ENV]
  delete env[CLAUDE_ARGS_ENV]
  return env
}

/**
 * A thread's Muse session.
 *
 * One turn at a time, like every harness: the runtime serialises turns per
 * thread, and two overlapping one-shot runs would race on one mapping file.
 */
export class ClaudeSession {
  private child: ChildProcess | null = null
  private abortRequested = false
  private readonly threadId: string
  private readonly deps: ClaudeSessionDeps

  constructor(threadId: string, deps: ClaudeSessionDeps) {
    this.threadId = threadId
    this.deps = deps
  }

  /**
   * Run one turn and report it as it happens.
   *
   * Live text comes from the CLI's partial-message deltas and is for a human
   * watching; the assembled turn is what the runtime records as facts. The
   * first turn seeds the session with the thread's full history, later turns
   * send only the latest user text while `--resume` carries the session.
   */
  async run(input: ClaudeRunInput, emit: (event: HarnessEvent) => void): Promise<void> {
    if (this.child !== null) {
      throw new ClaudeBridgeError({
        code: 'busy',
        message: `thread ${this.threadId} is already running a turn`,
        retryable: false,
      })
    }
    this.abortRequested = false
    try {
      const mapping = this.readMapping()
      const fresh = mapping === null || mapping.cwd !== input.cwd
      if (mapping !== null && mapping.cwd !== input.cwd) {
        emit(
          HarnessEvent.SessionReplaced({
            reason: 'the thread working directory changed, so Muse started a fresh session',
          }),
        )
      }
      const prompt = fresh ? historyToPrompt(input.history) : latestUserText(input.history)
      if (prompt === undefined || prompt === '') {
        throw new ClaudeBridgeError({
          code: 'no_prompt',
          message: `thread ${this.threadId} has no user message for Muse to answer`,
          retryable: false,
        })
      }
      const resumeId = fresh ? undefined : mapping?.sessionId
      try {
        await this.attemptTurn(
          {
            prompt,
            model: input.model,
            instructions: input.instructions,
            resumeId,
            cwd: input.cwd,
          },
          emit,
        )
      } catch (cause) {
        if (
          resumeId !== undefined &&
          !this.abortRequested &&
          Schema.is(ClaudeBridgeError)(cause) &&
          isResumeUnknown(cause.message)
        ) {
          emit(
            HarnessEvent.SessionReplaced({
              reason: 'the resumed Muse session was unknown, so Muse started a fresh session',
            }),
          )
          await this.attemptTurn(
            {
              prompt: historyToPrompt(input.history),
              model: input.model,
              instructions: input.instructions,
              resumeId: undefined,
              cwd: input.cwd,
            },
            emit,
          )
          return
        }
        throw cause
      }
    } finally {
      this.child = null
    }
  }

  /** Kill the running turn, which then fails with the reason. Idles when none runs. */
  async abort(): Promise<void> {
    const child = this.child
    if (child === null || child.exitCode !== null) return
    this.abortRequested = true
    child.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, SIGKILL_ESCALATION_MS)
    timer.unref()
  }

  /** Release a live turn, if any. The mapping stays, so resuming is implicit. */
  async stop(): Promise<void> {
    await this.abort()
  }

  /** Release a live turn and forget the thread's session pointer. */
  async discard(): Promise<void> {
    await this.abort()
    rmSync(mapFileFor(this.deps.paths, this.threadId), { force: true })
  }

  /** Point another thread at this thread's session, so it resumes where this one is. */
  async fork(request: HarnessForkRequest): Promise<void> {
    const source = this.readMappingFile(request.sourceThreadId)
    if (source === null) {
      throw new ClaudeBridgeError({
        code: 'no_session',
        message: `thread ${request.sourceThreadId} has no Muse session to fork`,
        retryable: false,
      })
    }
    this.writeMappingFile(request.targetThreadId, {
      sessionId: source.sessionId,
      cwd: request.cwd ?? source.cwd,
    })
  }

  private async attemptTurn(
    attempt: TurnAttempt,
    emit: (event: HarnessEvent) => void,
  ): Promise<void> {
    const argv: string[] = [
      '-p',
      attempt.prompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--model',
      attempt.model ?? this.deps.defaultModel,
      '--permission-mode',
      'acceptEdits',
      '--permission-prompts',
      'none',
    ]
    if (attempt.resumeId !== undefined) argv.push('--resume', attempt.resumeId)
    argv.push('--add-dir', attempt.cwd)
    if (attempt.instructions !== undefined && attempt.instructions.trim() !== '') {
      argv.push('--append-system-prompt', attempt.instructions)
    }

    const child = spawn(this.deps.launch.command, [...this.deps.launch.args, ...argv], {
      cwd: attempt.cwd,
      env: claudeChildEnv(this.deps.env),
    })
    this.child = child

    let deltas = ''
    const assistantTexts: string[] = []
    let resultText: string | undefined
    let usage: TurnUsage | undefined
    let failure: string | undefined
    let sessionId: string | undefined
    let stderrTail = ''
    let remainder = ''

    const onLine = (line: string): void => {
      const translated = translateLine(line)
      if (translated === undefined) return
      if (translated.sessionId !== undefined) sessionId = translated.sessionId
      if (translated.delta !== undefined) {
        deltas += translated.delta
        emit(HarnessEvent.TextDelta({ text: translated.delta }))
      }
      if (translated.assistantText !== undefined) assistantTexts.push(translated.assistantText)
      if (translated.resultText !== undefined) resultText = translated.resultText
      if (translated.usage !== undefined) usage = translated.usage
      if (translated.failure !== undefined) {
        failure = failure === undefined ? translated.failure : `${failure}; ${translated.failure}`
      }
    }

    if (child.stdout !== null) {
      child.stdout.on('data', (chunk: Buffer) => {
        remainder += chunk.toString()
        const lines = remainder.split('\n')
        remainder = lines.pop() ?? ''
        for (const line of lines) onLine(line)
      })
    }
    if (child.stderr !== null) {
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderrTail = (stderrTail + text).slice(-STDERR_TAIL_BYTES)
      })
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: ClaudeBridgeError): void => {
        if (settled) return
        settled = true
        reject(error)
      }
      child.on('error', (error: Error) => {
        fail(
          new ClaudeBridgeError({
            code: 'spawn_failed',
            message: `could not start Muse: ${error.message}`,
            retryable: false,
          }),
        )
      })
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return
        settled = true
        if (remainder.trim() !== '') onLine(remainder)
        if (this.abortRequested) {
          reject(
            new ClaudeBridgeError({
              code: 'aborted',
              message: `the turn on thread ${this.threadId} was aborted`,
              retryable: false,
            }),
          )
          return
        }
        const output = failure === undefined ? stderrTail : `${stderrTail}\n${failure}`
        if (code === 0 && failure === undefined) {
          if (sessionId !== undefined) {
            this.writeMapping({ sessionId, cwd: attempt.cwd })
          }
          const joined = assistantTexts.join('')
          const text = deltas !== '' ? deltas : joined !== '' ? joined : (resultText ?? '')
          emit(
            HarnessEvent.TurnComplete({
              turn: {
                items: [assistantText(text)],
                usage: usage ?? {},
                stop_reason: 'stop',
              },
            }),
          )
          resolve()
          return
        }
        reject(
          new ClaudeBridgeError({
            code: 'turn_failed',
            message:
              output.trim() === ''
                ? `Muse exited (code ${code ?? 'null'}, signal ${signal ?? 'null'})`
                : output.trim(),
            retryable: false,
          }),
        )
      })
    })
  }

  private readMapping(): { readonly sessionId: string; readonly cwd: string } | null {
    return this.readMappingFile(this.threadId)
  }

  private readMappingFile(
    threadId: string,
  ): { readonly sessionId: string; readonly cwd: string } | null {
    let raw: string
    try {
      raw = readFileSync(mapFileFor(this.deps.paths, threadId), 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    const decoded = decodeOption(ThreadMapping)(parsed)
    if (Option.isNone(decoded)) return null
    return { sessionId: decoded.value.sessionId, cwd: decoded.value.cwd }
  }

  private writeMapping(mapping: { readonly sessionId: string; readonly cwd: string }): void {
    this.writeMappingFile(this.threadId, mapping)
  }

  private writeMappingFile(
    threadId: string,
    mapping: { readonly sessionId: string; readonly cwd: string },
  ): void {
    const file = mapFileFor(this.deps.paths, threadId)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(mapping), 'utf8')
  }
}
