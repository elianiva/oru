import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cause, Effect, Queue, Schema, Stream } from 'effect'
import { definePlugin } from '@oru/kernel'
import { PiBridgeConfig, envOf } from './config.ts'
import {
  HarnessKind,
  HarnessError,
  defineHarness,
  type HarnessEvent,
  type HarnessService,
  type HarnessTurnRequest,
  type Mutable,
  type ToolContribution,
} from '@oru/harness'
import { ORU_PI_EXTENSION_SOURCE } from './pi/extension.ts'
import { resolvePiPaths, type PiPaths } from './pi/paths.ts'
import { resolvePiLaunch } from './pi/rpc-child.ts'
import { PiBridgeError, PiSession, type PiRunInput } from './pi/session.ts'
import { toolBridgeOf, type PiToolBridge } from './pi/tools.ts'
import { PiCatalog } from './pi/catalog.ts'

/**
 * `harness-pi`, pi as an oru harness.
 *
 * pi owns the agent loop (its own session, compaction, tools, steering) and oru
 * owns the record, the tools it contributes, and the turn boundary. The bridge
 * is a `pi --mode rpc` subprocess per thread plus an injected extension, wired
 * over fds 3/4, and oru's tools reach pi through that extension. Nothing here
 * installs, signs in, or repairs pi; it reports what it finds (ADR-0007).
 *
 * This module is the plugin's server facet. The host loads it through the
 * generic plugin-source loader, the same path any third-party harness uses.
 * Nothing in the host imports this module statically.
 */

const toHarnessError = (cause: unknown): HarnessError => {
  if (Schema.is(PiBridgeError)(cause)) {
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

const NO_TOOLS: PiToolBridge = {
  tools: [],
  run: (name) =>
    Promise.resolve({
      text: JSON.stringify({
        error: { kind: 'no_toolkit', message: `no toolkit was bound, so "${name}" cannot run` },
      }),
      isError: true,
    }),
}

export interface PiHarness {
  readonly service: HarnessService
  /** Stop every thread's pi child. Called when the plugin deactivates. */
  readonly shutdown: () => void
}

/**
 * Open the bridge in one environment. Each instance owns its own sessions,
 * decisions and scratch space, so a test handing a scripted environment gets
 * an isolated bridge without touching another. Absent input runs on the
 * process environment, the way the old no-argument factory did.
 */
export const openPiHarness = (input?: {
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly log?: ((message: string) => void) | undefined
}): Effect.Effect<PiHarness> =>
  Effect.sync(() => {
    const env = input?.env ?? process.env
    const log =
      input?.log ?? ((message: string) => process.stderr.write(`oru harness-pi: ${message}\n`))
    const sessions = new Map<string, PiSession>()
    const launch = resolvePiLaunch(env)
    const catalog = new PiCatalog({ env, launch, log })
    let paths: PiPaths | null = null
    let extensionPath: string | null = null

    const pathsNow = (): PiPaths => (paths ??= resolvePiPaths(env))

    /** The extension pi loads: written once per process, into this instance's scratch dir. */
    const extensionNow = (): string => {
      if (extensionPath !== null) return extensionPath
      const file = join(pathsNow().scratchDir, 'oru-pi-extension.mjs')
      writeFileSync(file, ORU_PI_EXTENSION_SOURCE, 'utf8')
      extensionPath = file
      return file
    }

    const sessionFor = (threadId: string): PiSession => {
      const existing = sessions.get(threadId)
      if (existing !== undefined) return existing
      const created = new PiSession(threadId, {
        env,
        paths: pathsNow(),
        extensionPath: extensionNow(),
        log,
        onDefaultModel: (modelId) => catalog.observeThreadDefault(modelId),
      })
      sessions.set(threadId, created)
      return created
    }

    const inputOf = (request: HarnessTurnRequest): PiRunInput => {
      const execute =
        request.executeTool ??
        (async () => ({ ok: false as const, result: 'no tool executor was bound' }))
      const input: Mutable<PiRunInput> = {
        cwd: request.cwd ?? process.cwd(),
        history: request.history,
        bridge:
          request.tools === undefined
            ? NO_TOOLS
            : toolBridgeOf(
                // SAFETY: ToolContribution carries exactly the name, description, and parameters the bridge reads, so narrowing to it recovers the runner without re-checking the shape.
                request.tools as ToolContribution[],
                execute,
              ),
        model: request.model,
        reasoning: request.reasoning,
        instructions: request.instructions,
      }
      if (request.awaitToolApproval !== undefined) input.awaitApproval = request.awaitToolApproval
      return input
    }

    const service = defineHarness({
      meta: { id: 'pi', label: 'pi', icon: 'terminal' },
      capabilities: {
        modelListing: true,
        streaming: true,
        tools: true,
        images: true,
        reasoning: true,
        // pi keeps its session file, so a restarted oru resumes the thread where it was.
        sessionRestore: true,
        // pi owns the conversation: the runtime's history seeds it exactly once.
        ownsHistory: true,
        // pi injects steering into the running turn rather than queueing it.
        steering: 'inject',
        interruption: true,
      },
      listModels: () => Effect.tryPromise({ try: () => catalog.models(), catch: toHarnessError }),
      providers: () => Effect.tryPromise({ try: () => catalog.providers(), catch: toHarnessError }),
      streamTurn: (request) =>
        Stream.callback<HarnessEvent, HarnessError>((queue) =>
          // Live events go out as they happen, and the queue is what ends the
          // stream: the turn completes when pi's run completes, and a failed run
          // fails the stream with the reason rather than leaving it open.
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
      steer: (threadId, text) =>
        Effect.tryPromise({ try: () => sessionFor(threadId).steer(text), catch: toHarnessError }),
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
      compact: (request) =>
        Effect.tryPromise({
          try: () => sessionFor(request.threadId).compact(request.instructions),
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
            log(`failed to stop a pi session: ${toHarnessError(cause).message}`)
          })
        }
        sessions.clear()
        catalog.invalidate()
      },
    }
  })

/**
 * The pi bridge, as a plugin.
 *
 * The bridge's environment is the plugin's `Config`: plain data the host
 * resolves and hands over, so a test aims the bridge at a scripted pi with
 * a config value and the app hands it the user's own environment. Both are
 * the same plugin id, so a host has exactly one pi bridge. The harness is
 * explicit: no ambient singleton reads `process.env` at import time.
 */
export const harnessPiPlugin = definePlugin({
  id: 'oru/harness-pi',
  Config: PiBridgeConfig,
  apply: (ctx, config) =>
    Effect.gen(function* () {
      // A configured env is used as-is, so a scripted test stays hermetic;
      // absent configuration the bridge runs on the process environment,
      // the way the old no-argument factory did.
      const env = envOf(config.env)
      const harness = yield* openPiHarness({ env })
      // The contributed value is built here, so apply registers the harness
      // plus the teardown that stops every pi child this instance spawned
      // (ADR-0007).
      yield* ctx.contribute(HarnessKind.of(harness.service))
      yield* ctx.effect(Effect.sync(() => harness.shutdown()))
    }),
})

export default harnessPiPlugin
