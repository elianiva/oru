import { describe, expect, it } from 'vitest'
import { Context, Effect, Schema, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import {
  contribute,
  definePlugin,
  makeHost,
  provide,
  SessionLog,
  sessionLogLayer,
} from '@oru/kernel'
import { Inference, inferencePlugin, Model } from '../src/index.ts'
import { ToolKind } from '../src/tool-kind.ts'

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    contribute(ToolKind, {
      name: 'echo',
      description: 'Return the text that was passed in.',
      execute: (argumentsJson) =>
        Effect.try({
          try: () => JSON.parse(argumentsJson),
          catch: () => new Error('invalid tool arguments'),
        }).pipe(
          Effect.flatMap((raw) => Schema.decodeUnknownEffect(EchoArgs)(raw)),
          Effect.map((input) => ({ ok: true, result: JSON.stringify({ echoed: input.text }) })),
          Effect.catch(() => Effect.succeed({ ok: false, result: 'tool failed' })),
        ),
    }),
  ],
})

const fakeModelPlugin = definePlugin({
  id: 'model/fake',
  provides: [provide(Model)],
  server: {
    setup: () =>
      Effect.succeed(
        Context.make(Model, {
          streamTurn: (history) => {
            const alreadyRan = history.some((item) => item._tag === 'tool')
            if (alreadyRan) return Effect.succeed([{ _tag: 'text' as const, text: 'done' }])
            return Effect.succeed([
              {
                _tag: 'tool' as const,
                name: 'echo',
                call: 'call_1',
                arguments: JSON.stringify({ text: 'hi' }),
              },
            ])
          },
        }),
      ),
  },
})

const runRuntime = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | SessionLog | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('inference runtime', () => {
  it('records a user message, a turn, a tool request, and a tool result', async () => {
    await runRuntime(
      Effect.gen(function* () {
        const host = yield* makeHost([echoToolPlugin, fakeModelPlugin, inferencePlugin])
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
})
