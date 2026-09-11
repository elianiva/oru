import { Context, Effect, Scope } from 'effect'
import { LanguageModel } from '@effect-uai/core/LanguageModel'
import {
  definePlugin,
  provide,
  SessionLog,
  type PluginContext,
  type ServerFacet,
} from '@oru/kernel'
import { Inference, openInference } from './inference.ts'
import { ToolKind } from './tool-kind.ts'

const setup = (ctx: PluginContext<readonly []>) =>
  Effect.gen(function* () {
    const languageModel = yield* LanguageModel
    const log = yield* SessionLog
    const loadTools = ctx
      .contributions(ToolKind)
      .pipe(Effect.map((entries) => entries.map((entry) => entry.value)))
    const scope = yield* Scope.Scope
    return Context.make(Inference, openInference(log, languageModel, loadTools, scope))
  })

export const inferencePlugin = definePlugin({
  id: 'oru/inference',
  provides: [provide(Inference)],
  server: {
    // SAFETY: host erases setup R; LanguageModel is provided on the fiber via demoModelLayer
    setup: setup as ServerFacet<
      readonly [],
      ReturnType<typeof provide<typeof Inference>>[]
    >['setup'],
  },
})
