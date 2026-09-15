import { describe, expect, it } from 'vitest'
import { Effect, Fiber, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { definePlugin, makeHost, SessionLog, sessionLogLayer } from '@oru/kernel'
import { harnessOruPlugin } from '@oru/harness-oru'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import {
  defineTool,
  demoModelPlugin,
  Inference,
  inferencePlugin,
  mockModelPlugin,
} from '../src/index.ts'
import { ToolKind } from '../src/tool-kind.ts'

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    ToolKind.of(
      defineTool({
        name: 'echo',
        description: 'Return the text that was passed in.',
        parameters: EchoArgs,
        execute: (input) => Effect.succeed(JSON.stringify({ echoed: input.text })),
      }),
    ),
  ],
})

const approveOnRequest = (
  inference: Inference['Service'],
  thread: string,
): Effect.Effect<void, never, SessionLog | Scope.Scope> =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const live = yield* log.subscribe
    yield* live.pipe(
      Stream.runForEach((event) =>
        event._tag === 'tool/requested' && event.thread === thread
          ? inference.decide(thread, event.call, 'approve').pipe(Effect.orDie)
          : Effect.void,
      ),
      Effect.forkScoped,
    )
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
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          demoModelPlugin,
          harnessOruPlugin,
          inferencePlugin,
        ])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* approveOnRequest(inference, 't1')
        yield* inference.send('t1', 'hello')
        yield* inference.whenIdle('t1')
        const tags = (yield* log.entries).map((event) => event._tag)
        expect(tags).toContain('message/appended')
        expect(tags).toContain('turn/started')
        expect(tags).toContain('tool/requested')
        expect(tags).toContain('approval/decided')
        expect(tags).toContain('tool/completed')
      }),
    )
  })

  it('records a denied tool as a failed completion', async () => {
    await runRuntime(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          demoModelPlugin,
          harnessOruPlugin,
          inferencePlugin,
        ])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        const live = yield* log.subscribe
        const watching = yield* live.pipe(
          Stream.filter((event) => event._tag === 'tool/completed'),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        const requests = yield* log.subscribe
        yield* requests.pipe(
          Stream.filter((event) => event._tag === 'tool/requested' && event.thread === 't1'),
          Stream.take(1),
          Stream.runForEach((event) =>
            event._tag === 'tool/requested'
              ? inference.decide('t1', event.call, 'deny').pipe(Effect.orDie)
              : Effect.void,
          ),
          Effect.forkScoped,
        )
        yield* inference.send('t1', 'hello')
        yield* Fiber.join(watching)
        const completed = (yield* log.entries).find((event) => event._tag === 'tool/completed')
        expect(completed?._tag === 'tool/completed' ? completed.ok : undefined).toBe(false)
        expect(completed?._tag === 'tool/completed' ? completed.result : '').toBe(
          'the user denied this tool call',
        )
      }),
    )
  })

  it('writes turn/failed and still succeeds send when the model dies', async () => {
    await runRuntime(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          mockModelPlugin('oru/model-empty', []),
          harnessOruPlugin,
          inferencePlugin,
        ])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* inference.send('t1', 'hello')
        yield* inference.whenIdle('t1')
        const tags = (yield* log.entries).map((event) => event._tag)
        expect(tags).toContain('turn/started')
        expect(tags).toContain('turn/failed')
        expect(tags).not.toContain('tool/requested')
        const failed = (yield* log.entries).find((event) => event._tag === 'turn/failed')
        expect(failed?._tag).toBe('turn/failed')
        if (failed?._tag === 'turn/failed') expect(failed.reason.length).toBeGreaterThan(0)
      }),
    )
  })
})
