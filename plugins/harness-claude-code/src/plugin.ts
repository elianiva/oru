import { Cause, Context, Effect, Option, Queue, Schema, Stream } from 'effect'
import { definePlugin, type AnyPlugin } from '@oru/kernel'
import { ClaudeConfig } from './config.ts'
import {
  HarnessKind,
  HarnessError,
  defineHarness,
  type HarnessEvent,
  type HarnessService,
  type HarnessTurnRequest,
} from '@oru/harness'
import { ClaudeCatalog, DEFAULT_CLAUDE_MODEL } from './claude/catalog.ts'
import { resolveClaudeLaunch } from './claude/launch.ts'
import { resolveClaudePaths } from './claude/paths.ts'
import { ClaudeBridgeError, ClaudeSession, type ClaudeRunInput } from './claude/session.ts'

/**
 * `harness-claude-code`, Muse as an oru harness.
 *
 * Muse owns the agent loop (its own session, compaction, steering) and oru
 * owns the record and the turn boundary. The bridge is a one-shot `claude -p`
 * child per turn with `--resume` pointing at the thread's session, and oru
 * keeps only the thread-to-session pointer. Nothing here installs, signs in,
 * or repairs the CLI; it reports what it finds (ADR-0007).
 *
 * This module is the plugin's server facet. The host loads it through the
 * generic plugin-source loader, the same path any third-party harness uses.
 * Nothing in the host imports this module statically.
 */

/**
 * The bridge's environment, as a service rather than a factory parameter.
 *
 * Configuration arrives as a service rather than a factory parameter, so
 * tests use the Effect idiom instead of injecting fakes through parameters:
 * the composition root provides the real environment with
 * `Effect.provideService`, tests provide the scripted one, and
 * the plugin reads whichever is active through its coeffects.
 */
const toHarnessError = (cause: unknown): HarnessError => {
  if (Schema.is(ClaudeBridgeError)(cause)) {
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
export const openClaudeHarness: Effect.Effect<ClaudeHarness, never, ClaudeConfig> = Effect.gen(
  function* () {
    const config = yield* ClaudeConfig
    const env = config.env ?? process.env
    const log =
      config.log ??
      ((message: string) => process.stderr.write(`oru harness-claude-code: ${message}\n`))
    const sessions = new Map<string, ClaudeSession>()
    const launch = resolveClaudeLaunch(env)
    const catalog = new ClaudeCatalog({ env, launch, log })
    const paths = resolveClaudePaths(env)

    const sessionFor = (threadId: string): ClaudeSession => {
      const existing = sessions.get(threadId)
      if (existing !== undefined) return existing
      const created = new ClaudeSession(threadId, {
        env,
        paths,
        launch,
        defaultModel: DEFAULT_CLAUDE_MODEL,
        log,
      })
      sessions.set(threadId, created)
      return created
    }

    const inputOf = (request: HarnessTurnRequest): ClaudeRunInput => ({
      cwd: request.cwd ?? process.cwd(),
      history: request.history,
      model: request.model,
      instructions: request.instructions,
    })

    const service = defineHarness({
      meta: { id: 'Muse', label: 'Muse', icon: 'terminal' },
      capabilities: {
        modelListing: true,
        streaming: true,
        tools: false,
        images: false,
        reasoning: false,
        // The mapping file outlives the process, so a restarted oru resumes
        // the thread where it was.
        sessionRestore: true,
        // Muse owns the conversation: the runtime's history seeds it on
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
            log(`failed to stop a Muse session: ${toHarnessError(cause).message}`)
          })
        }
        sessions.clear()
        catalog.invalidate()
      },
    }
  },
)

/**
 * The Muse bridge, as a plugin.
 *
 * A constant rather than a factory because the bridge's environment is a
 * coeffect now: the plugin reads `ClaudeConfig` and contributes the harness
 * the config builds. A test points the bridge at a scripted `claude` by
 * providing another config value, and the app provides the `claude` the user
 * installed. Both are the same plugin id, so a host has exactly one Muse
 * bridge. The harness is explicit: no ambient singleton reads `process.env`
 * at import time.
 */
export const harnessClaudeCodePlugin: AnyPlugin = definePlugin({
  id: 'oru/harness-claude-code',
  provides: [],
  server: {
    setup: (ctx) =>
      Effect.gen(function* () {
        // Plain data, so ambient configuration rather than a coeffect: the
        // kernel's facades only forward method bags. Absent configuration
        // opens the bridge on the process environment, the way the old
        // no-argument factory did; importing the module never reads it.
        const config = yield* Effect.serviceOption(ClaudeConfig).pipe(
          Effect.map((option) => Option.getOrElse(option, () => ({}))),
        )
        const harness = yield* Effect.provideService(openClaudeHarness, ClaudeConfig, config)
        // The contributed value is built here, so setup registers the harness
        // plus the teardown that kills every `claude` child this instance
        // spawned (ADR-0007).
        yield* ctx.contribute(HarnessKind.of(harness.service))
        yield* Effect.addFinalizer(() => Effect.sync(() => harness.shutdown()))
        return Context.empty()
      }),
  },
})

/** The record the generic plugin-source loader reads. */
export const plugin: AnyPlugin = harnessClaudeCodePlugin

export default harnessClaudeCodePlugin
