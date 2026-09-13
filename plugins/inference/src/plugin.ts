import { Context, Effect, Scope } from 'effect'
import { LanguageModel } from '@effect-uai/core/LanguageModel'
import { definePlugin, SessionLog, type PluginContext } from '@oru/kernel'
import { Inference, openInference } from './inference.ts'
import { ToolKind } from './tool-kind.ts'

const setup = (ctx: PluginContext<readonly [typeof LanguageModel]>) =>
  Effect.gen(function* () {
    const languageModel = ctx.service(LanguageModel)
    const log = yield* SessionLog
    const loadTools = ctx
      .contributions(ToolKind)
      .pipe(Effect.map((entries) => entries.map((entry) => entry.value)))
    const scope = yield* Scope.Scope
    return Context.make(Inference, openInference(log, languageModel, loadTools, scope))
  })

export const inferencePlugin = definePlugin({
  id: 'oru/inference',
  needs: [LanguageModel],
  provides: [Inference],
  server: { setup },
})
