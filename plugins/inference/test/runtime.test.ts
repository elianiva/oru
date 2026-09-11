import { describe, expect, it } from 'vitest'
import { Effect, Layer, Schema, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { LanguageModel } from '@effect-uai/core/LanguageModel'
import * as MockProvider from '@effect-uai/core/testing/MockProvider'
import { contribute, definePlugin, makeHost, SessionLog, sessionLogLayer } from '@oru/kernel'
import { demoModelLayer, defineTool, Inference, inferencePlugin } from '../src/index.ts'
import { ToolKind } from '../src/tool-kind.ts'

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    contribute(
      ToolKind,
      defineTool({
        name: 'echo',
        description: 'Return the text that was passed in.',
        parameters: EchoArgs,
        execute: (input) => Effect.succeed({ echoed: input.text }),
      }),
    ),
  ],
})

const runRuntime = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | LanguageModel | Scope.Scope>,
  model: Layer.Layer<LanguageModel> = demoModelLayer,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(
        Effect.provide(sessionLogLayer),
        Effect.provide(EventJournal.layerMemory),
        Effect.provide(model),
      ),
    ),
  )

describe('inference runtime', () => {
  it('records a user message, a turn, a tool request, and a tool result', async () => {
    await runRuntime(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, inferencePlugin])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* inference.send('t1', 'hello')
        const tags = (yield* log.entries).map((event) => event._tag)
        expect(tags).toContain('message/appended')
        expect(tags).toContain('turn/started')
        expect(tags).toContain('tool/requested')
        expect(tags).toContain('tool/completed')
      }),
    )
  })

  it('writes turn/failed and still succeeds send when the model dies', async () => {
    await runRuntime(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, inferencePlugin])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* inference.send('t1', 'hello')
        const tags = (yield* log.entries).map((event) => event._tag)
        expect(tags).toContain('turn/started')
        expect(tags).toContain('turn/failed')
        expect(tags).not.toContain('tool/requested')
        const failed = (yield* log.entries).find((event) => event._tag === 'turn/failed')
        expect(failed?._tag).toBe('turn/failed')
        if (failed?._tag === 'turn/failed') expect(failed.reason.length).toBeGreaterThan(0)
      }),
      MockProvider.layer([]),
    )
  })
})
