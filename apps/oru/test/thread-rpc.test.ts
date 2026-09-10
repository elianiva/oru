import { describe, expect, it } from 'vitest'
import { Context, Effect, Schema, Stream } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { RpcTest } from 'effect/unstable/rpc'
import {
  contribute,
  definePlugin,
  makeHost,
  provide,
  SessionLog,
  sessionLogLayer,
} from '@oru/kernel'
import { inferencePlugin, Model, ToolKind } from '@oru/inference'
import { ThreadRpc, threadRpcHandlers } from '../src/thread-rpc.ts'

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
            if (alreadyRan) {
              return Effect.succeed(Stream.succeed({ _tag: 'text' as const, text: 'done' }))
            }
            return Effect.succeed(
              Stream.succeed({
                _tag: 'tool' as const,
                name: 'echo',
                call: 'call_1',
                arguments: JSON.stringify({ text: 'hi' }),
              }),
            )
          },
        }),
      ),
  },
})

describe('thread rpc', () => {
  it('sends a message and watches turn and tool facts for that thread', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([echoToolPlugin, fakeModelPlugin, inferencePlugin])
          const client = yield* RpcTest.makeClient(ThreadRpc).pipe(
            Effect.provide(ThreadRpc.toLayer(threadRpcHandlers(host))),
          )
          const created = yield* client.CreateThread()
          yield* client.SendMessage({ threadId: created.threadId, text: 'hello' })
          const log = yield* SessionLog
          const tags: string[] = []
          for (const event of yield* log.entries) {
            if (event._tag === 'plugin/activated' || event._tag === 'plugin/deactivated') continue
            tags.push(event._tag)
          }
          expect(tags).toContain('message/appended')
          expect(tags).toContain('turn/started')
          expect(tags).toContain('tool/requested')
          expect(tags).toContain('tool/completed')
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
      ),
    )
  })
})
