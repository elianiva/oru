import { describe, expect, it } from 'vitest'
import { Predicate, Effect, Fiber, Stream, type Scope } from 'effect'
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
import { harnessRegistryPlugin } from '@oru/harness-registry'
import { defaultCapabilities, defineHarness, Inference, inferencePlugin } from '../src/index.ts'

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
  it('runs the next turn of a thread in the cwd its project was edited to', async () => {
    const before = '/tmp/oru-before'
    const after = '/tmp/oru-after'
    const cwds: string[] = []

    await runRuntime(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin(),
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
})
