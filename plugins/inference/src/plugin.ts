import { Context, Effect, Scope } from 'effect'
import { definePlugin, SessionLog, type PluginContext } from '@oru/kernel'
import { Harness } from '@oru/harness'
import { Inference, openInference } from './inference.ts'
import { ToolKind } from './tool-kind.ts'

const setup = (ctx: PluginContext) =>
  Effect.gen(function* () {
    const harness = yield* Harness
    const log = yield* SessionLog
    const loadTools = ctx
      .contributions(ToolKind)
      .pipe(Effect.map((entries) => entries.map((entry) => entry.value)))
    const scope = yield* Scope.Scope
    return Context.make(Inference, openInference(log, harness, loadTools, scope))
  })

/**
 * `oru/inference` — the kernel's agent loop.
 *
 * Now depends only on the unified `Harness` token, not on any specific
 * provider. Whichever harness plugin is active (harness-oru, harness-pi,
 * harness-claude-code, harness-codex, …) satisfies this coeffect.
 *
 * This is the user-visible invariant:
 *   - provide one harness → inference runs
 *   - swap harnesses → inference keeps running, no caller change
 */
export const inferencePlugin = definePlugin({
  id: 'oru/inference',
  needs: [Harness],
  provides: [Inference],
  server: { setup },
})
