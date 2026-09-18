import { Context, Effect, Scope } from 'effect'
import { BootKind, definePlugin, SessionLog, type PluginContext } from '@oru/kernel'
import { Harnesses } from './harness.ts'
import { Runtime } from './runtime-token.ts'
import { openRuntime } from './runtime-fn.ts'
import { ToolKind } from './tools.ts'

const setup = (ctx: PluginContext) =>
  Effect.gen(function* () {
    const harnesses = yield* Harnesses
    const log = yield* SessionLog
    const loadTools = ctx
      .contributions(ToolKind)
      .pipe(Effect.map((entries) => entries.map((entry) => entry.value)))
    const scope = yield* Scope.Scope
    const runtime = yield* openRuntime(log, harnesses, loadTools, scope)
    // A restarted host finishes what the journal left running, once the graph
    // the loop reads is assembled (ADR-0010).
    yield* ctx.contribute(BootKind.of(runtime.resume()))
    return Context.make(Runtime, runtime)
  })

/**
 * The host's turn driver, as a plugin.
 *
 * Depends on the harness *registry*, not on any one harness: whichever plugins
 * contribute a `HarnessKind` are candidates, and each thread picks one through
 * its own configuration (ADR-0006). The driver folds the session log, derives
 * turn work, asks the active harness for deltas, and records the facts.
 * Bridges stay the only harness implementers.
 */
export const runtimePlugin = definePlugin({
  id: 'oru/runtime',
  needs: [Harnesses],
  provides: [Runtime],
  server: { setup },
})
