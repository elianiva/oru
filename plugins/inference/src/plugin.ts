import { Context, Effect, Scope } from 'effect'
import { BootKind, definePlugin, SessionLog, type PluginContext } from '@oru/kernel'
import { Harnesses } from '@oru/harness'
import { Inference, openInference } from './inference.ts'
import { ToolKind } from './tool-kind.ts'

const setup = (ctx: PluginContext) =>
  Effect.gen(function* () {
    const harnesses = yield* Harnesses
    const log = yield* SessionLog
    const loadTools = ctx
      .contributions(ToolKind)
      .pipe(Effect.map((entries) => entries.map((entry) => entry.value)))
    const scope = yield* Scope.Scope
    const inference = yield* openInference(log, harnesses, loadTools, scope)
    // A restarted host finishes what the journal left running, once the graph
    // the loop reads is assembled (ADR-0009).
    yield* ctx.contribute(BootKind.of(inference.resume()))
    return Context.make(Inference, inference)
  })

/**
 * `oru/inference`, the kernel's agent loop.
 *
 * Depends on the harness *registry*, not on any one harness: whichever plugins
 * contribute a `HarnessKind` are candidates, and each thread picks one through
 * its own configuration (ADR-0006). Swapping a harness, or adding a second one
 * beside the first, is a plugin-set change, not a code change.
 */
export const inferencePlugin = definePlugin({
  id: 'oru/inference',
  needs: [Harnesses],
  provides: [Inference],
  server: { setup },
})
