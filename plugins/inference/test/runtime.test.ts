import { describe, expect, it } from 'vitest'
import { Predicate, Effect, Fiber, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import * as Items from '@effect-uai/core/Items'
import * as Turn from '@effect-uai/core/Turn'
import {
  definePlugin,
  makeHost,
  ProjectCreated,
  ProjectUpdated,
  SessionLog,
  sessionLogLayer,
  ThreadConfigured,
  ThreadCreated,
  unsignedTree,
  type SessionLogContract,
} from '@oru/kernel'
import { HarnessKind } from '@oru/harness'
import { harnessOruPlugin } from '@oru/harness-oru'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import {
  defaultCapabilities,
  defineHarness,
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
        Predicate.isTagged(event, 'tool/requested') && event.thread === thread
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

/**
 * A bridge that records the directory the runtime handed it and completes the
 * turn, so a cwd change is observed where a cwd-bound bridge sees it:
 * `HarnessTurnRequest.cwd`.
 */
const recordingHarnessPlugin = (cwds: string[]) =>
  definePlugin({
    id: 'oru/harness-recording',
    provides: [
      HarnessKind.of(
        defineHarness({
          meta: { id: 'recording', label: 'Recording' },
          capabilities: { ...defaultCapabilities, tools: false, ownsHistory: true },
          streamTurn: (request) => {
            cwds.push(request.cwd ?? '')
            return Stream.succeed(
              Turn.TurnEvent.TurnComplete({
                turn: {
                  items: [Items.assistantText('done')],
                  usage: {},
                  stop_reason: 'stop',
                },
              }),
            )
          },
        }),
      ),
    ],
  })

/** One exchange, read off the live log so no turn is raced. */
const exchange = (
  log: SessionLogContract,
  inference: Inference['Service'],
  thread: string,
  text: string,
) =>
  Effect.gen(function* () {
    const live = yield* log.subscribe
    const answer = yield* live.pipe(
      Stream.filter(
        (event) =>
          Predicate.isTagged(event, 'message/appended') &&
          event.thread === thread &&
          event.role === 'assistant',
      ),
      Stream.take(1),
      Stream.runHead,
      Effect.forkScoped,
    )
    yield* inference.send(thread, text)
    yield* Fiber.join(answer)
  })

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
          Stream.filter((event) => Predicate.isTagged(event, 'tool/completed')),
          Stream.take(1),
          Stream.runCollect,
          Effect.forkScoped,
        )
        const requests = yield* log.subscribe
        yield* requests.pipe(
          Stream.filter(
            (event) => Predicate.isTagged(event, 'tool/requested') && event.thread === 't1',
          ),
          Stream.take(1),
          Stream.runForEach((event) =>
            Predicate.isTagged(event, 'tool/requested')
              ? inference.decide('t1', event.call, 'deny').pipe(Effect.orDie)
              : Effect.void,
          ),
          Effect.forkScoped,
        )
        yield* inference.send('t1', 'hello')
        yield* Fiber.join(watching)
        const completed = (yield* log.entries).find((event) =>
          Predicate.isTagged(event, 'tool/completed'),
        )
        expect(Predicate.isTagged(completed, 'tool/completed') ? completed.ok : undefined).toBe(
          false,
        )
        expect(Predicate.isTagged(completed, 'tool/completed') ? completed.result : '').toBe(
          'the user denied this tool call',
        )
      }),
    )
  })

  it('runs the next turn of a thread in the cwd its project was edited to', async () => {
    const before = '/tmp/oru-before'
    const after = '/tmp/oru-after'
    const cwds: string[] = []

    await runRuntime(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          recordingHarnessPlugin(cwds),
          inferencePlugin,
        ])
        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        yield* log.write(
          ProjectCreated.make({
            ...unsignedTree,
            id: 'e1',
            project: 'p1',
            name: 'demo',
            cwd: before,
          }),
        )
        yield* log.write(
          ThreadCreated.make({ ...unsignedTree, id: 'e2', thread: 't1', project: 'p1' }),
        )
        yield* log.write(
          ThreadConfigured.make({
            ...unsignedTree,
            id: 'e3',
            thread: 't1',
            harness: 'recording',
            model: undefined,
            reasoning: undefined,
          }),
        )

        yield* exchange(log, inference, 't1', 'first request')
        // The thread already exists; only its project's cwd changes.
        yield* log.write(
          ProjectUpdated.make({
            ...unsignedTree,
            id: 'e4',
            project: 'p1',
            name: 'demo',
            cwd: after,
          }),
        )
        yield* exchange(log, inference, 't1', 'second request')
      }),
    )

    expect(cwds).toEqual([before, after])
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
        const failed = (yield* log.entries).find((event) =>
          Predicate.isTagged(event, 'turn/failed'),
        )
        expect(failed?._tag).toBe('turn/failed')
        if (Predicate.isTagged(failed, 'turn/failed'))
          expect(failed.reason.length).toBeGreaterThan(0)
      }),
    )
  })
})
