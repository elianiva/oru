import { Cause, Effect, Queue, Schema, Stream } from 'effect'
import { definePlugin } from '@oru/kernel'
import { ClaudeCodeConfig, envOf } from './config.ts'
import {
  HarnessKind,
  HarnessError,
  defineHarness,
  type HarnessEvent,
  type HarnessService,
  type HarnessTurnRequest,
} from '@oru/harness'
import { ClaudeCodeCatalog, DEFAULT_CLAUDE_CODE_MODEL } from './claude/catalog.ts'
import { resolveClaudeCodeLaunch } from './claude/launch.ts'
import { resolveClaudeCodePaths } from './claude/paths.ts'
import {
  ClaudeCodeBridgeError,
  ClaudeCodeSession,
  type ClaudeCodeRunInput,
} from './claude/session.ts'

/**
 * `harness-claude-code`, Claude Code as an oru harness.
 *
 * Claude Code owns the agent loop (its own session, compaction, steering) and oru
 * owns the record and the turn boundary. The bridge is a one-shot `claude -p`
 * child per turn with `--resume` pointing at the thread's session, and oru
 * keeps only the thread-to-session pointer. Nothing here installs, signs in,
 * or repairs the CLI; it reports what it finds (ADR-0007).
 *
 * This module is the plugin's server facet. The host loads it through the
 * generic plugin-source loader, the same path any third-party harness uses.
 * Nothing in the host imports this module statically.
 */

const toHarnessError = (cause: unknown): HarnessError => {
  if (Schema.is(ClaudeCodeBridgeError)(cause)) {
    return new HarnessError({
      message: cause.message,
      code: cause.code,
      retryable: cause.retryable,
      cause,
    })
  }
  if (cause instanceof Error) {
    return new HarnessError({ message: cause.message, code: 'bridge_error', cause })
  }
  return new HarnessError({ message: String(cause), code: 'bridge_error', cause })
}

export interface ClaudeHarness {
  readonly service: HarnessService
  /** Kill every thread's running `claude` child. Called when the plugin deactivates. */
  readonly shutdown: () => void
}

/**
 * Open the bridge from the active config. Each instance owns its own sessions,
 * so a test providing a scripted environment gets an isolated bridge without
 * touching another.
 */
export const openClaudeCodeHarness = (input?: {
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly log?: ((message: string) => void) | undefined
}): Effect.Effect<ClaudeHarness> =>
  Effect.sync(() => {
    const env = input?.env ?? process.env
    const log =
      input?.log ??
      ((message: string) => process.stderr.write(`oru harness-claude-code: ${message}\n`))
    const sessions = new Map<string, ClaudeCodeSession>()
    const launch = resolveClaudeCodeLaunch(env)
    const catalog = new ClaudeCodeCatalog({ env, launch, log })
    const paths = resolveClaudeCodePaths(env)

    const sessionFor = (threadId: string): ClaudeCodeSession => {
      const existing = sessions.get(threadId)
      if (existing !== undefined) return existing
      const created = new ClaudeCodeSession(threadId, {
        env,
        paths,
        launch,
        defaultModel: DEFAULT_CLAUDE_CODE_MODEL,
        log,
      })
      sessions.set(threadId, created)
      return created
    }

    const inputOf = (request: HarnessTurnRequest): ClaudeCodeRunInput => ({
      cwd: request.cwd ?? process.cwd(),
      history: request.history,
      model: request.model,
      instructions: request.instructions,
    })

    const service = defineHarness({
      meta: { id: 'claude-code', label: 'Claude Code', icon: 'terminal' },
      capabilities: {
        modelListing: true,
        streaming: true,
        tools: false,
        images: false,
        reasoning: false,
        // The mapping file outlives the process, so a restarted oru resumes
        // the thread where it was.
        sessionRestore: true,
        // Claude Code owns the conversation: the runtime's history seeds it on
        // the first turn, and the CLI's own state is authoritative after.
        ownsHistory: true,
        // Steering arrives as the next turn's prompt; the runtime queues it.
        steering: 'queue',
        interruption: true,
      },
      listModels: () => Effect.tryPromise({ try: () => catalog.models(), catch: toHarnessError }),
      providers: () => Effect.tryPromise({ try: () => catalog.providers(), catch: toHarnessError }),
      streamTurn: (request) =>
        Stream.callback<HarnessEvent, HarnessError>((queue) =>
          // Live events go out as they happen, and the queue is what ends the
          // stream: the turn completes when the `claude -p` run completes, and
          // a failed run fails the stream with the reason rather than leaving
          // it open.
          Effect.sync(() => {
            const session = sessionFor(request.threadId)
            void session
              .run(inputOf(request), (event) => {
                Queue.offerUnsafe(queue, event)
              })
              .then(
                () => Queue.endUnsafe(queue),
                (cause: unknown) => Queue.failCauseUnsafe(queue, Cause.fail(toHarnessError(cause))),
              )
          }),
        ),
      abort: (threadId) =>
        Effect.tryPromise({ try: () => sessionFor(threadId).abort(), catch: toHarnessError }),
      stop: (threadId) =>
        Effect.tryPromise({ try: () => sessionFor(threadId).stop(), catch: toHarnessError }),
      discard: (threadId) =>
        Effect.tryPromise({
          try: async () => {
            await sessionFor(threadId).discard()
            sessions.delete(threadId)
          },
          catch: toHarnessError,
        }),
      fork: (request) =>
        Effect.tryPromise({
          try: () => sessionFor(request.sourceThreadId).fork(request),
          catch: toHarnessError,
        }),
      health: () => Effect.tryPromise({ try: () => catalog.health(), catch: toHarnessError }),
      invalidateHealth: () => Effect.sync(() => catalog.invalidate()),
    })

    return {
      service,
      shutdown: () => {
        for (const session of sessions.values()) {
          void session.stop().catch((cause: unknown) => {
            log(`failed to stop a Claude Code session: ${toHarnessError(cause).message}`)
          })
        }
        sessions.clear()
        catalog.invalidate()
      },
    }
  })

/**
 * The Claude Code bridge, as a plugin.
 *
 * The bridge's environment is the plugin's `Config`: plain data the host
 * resolves and hands over, so a test aims the bridge at a scripted `claude`
 * with a config value and the app hands it the user's own environment. Both
 * are the same plugin id, so a host has exactly one Claude Code bridge. The
 * harness is explicit: no ambient singleton reads `process.env` at import
 * time.
 */
export const harnessClaudeCodePlugin = definePlugin({
  id: 'oru/harness-claude-code',
  Config: ClaudeCodeConfig,
  apply: (ctx, config) =>
    Effect.gen(function* () {
      // A configured env is used as-is, so a scripted test stays hermetic;
      // absent configuration the bridge runs on the process environment,
      // the way the old no-argument factory did.
      const env = envOf(config.env)
      const harness = yield* openClaudeCodeHarness({ env })
      // The contributed value is built here, so apply registers the harness
      // plus the teardown that kills every `claude` child this instance
      // spawned (ADR-0007).
      yield* ctx.contribute(HarnessKind.of(harness.service))
      yield* ctx.effect(Effect.sync(() => harness.shutdown()))
    }),
})

export default harnessClaudeCodePlugin
