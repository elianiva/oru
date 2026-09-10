import { Context, Effect } from 'effect'
import { definePlugin, provide, SessionLog } from '@oru/kernel'
import { Inference, openInference } from './inference.ts'
import { Model } from './model.ts'
import { ToolKind } from './tool-kind.ts'

export const inferencePlugin = definePlugin({
  id: 'oru/inference',
  needs: [Model],
  provides: [provide(Inference)],
  server: {
    setup: Effect.fnUntraced(function* (ctx) {
      const log = yield* SessionLog
      const model = ctx.service(Model)
      const loadTools = ctx
        .contributions(ToolKind)
        .pipe(Effect.map((entries) => entries.map((entry) => entry.value)))
      const inference = openInference(log, model, loadTools)
      return Context.make(Inference, inference)
    }),
  },
})
