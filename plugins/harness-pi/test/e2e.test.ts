import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Predicate, Effect, Match, Option, Schema, Stream, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { Harnesses } from '@oru/harness'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import {
  defineTool,
  foldThread,
  Idle,
  Inference,
  inferencePlugin,
  ToolKind,
  workOf,
} from '@oru/inference'
import {
  definePlugin,
  makeHost,
  ProjectCreated,
  SessionLog,
  sessionLogLayer,
  ThreadCreated,
  unsignedTree,
  type SessionEvent,
} from '@oru/kernel'
import { harnessPiPlugin, makePiHarness, type PiHarness } from '../src/index.ts'
import { PI_CLI } from './scripted-provider.ts'

/**
 * The whole stack against the vendored pi and a real model: a real process, a
 * real provider account, a real tool call, and the facts oru records.
 *
 * This is the run a scripted provider cannot stand in for, and it spends real
 * money, so it only runs when the vendored pi is installed, signed in, and
 * offering the model: otherwise the suite reports a skip rather than pointing
 * at somebody's account by default. `ORU_PI_E2E_MODEL` overrides the model,
 * in pi's `provider/id` form, when the account to spend is a different one:
 *
 *   ORU_PI_E2E_MODEL=deepseek/deepseek-chat \
 *     pnpm --filter @oru/harness-pi e2e
 *
 * Only the model is real and shared: pi's session lands in a temporary
 * directory, so the run never touches the user's own threads.
 */

const MODEL = process.env.ORU_PI_E2E_MODEL ?? 'opencode-go/muse-spark-1.3-contributor'
const PROMPT = "Use the echo tool exactly once with text 'oru e2e', then answer with the word DONE."

const EchoArgs = Schema.Struct({ text: Schema.String })

const echoToolPlugin = definePlugin({
  id: 'tools/echo',
  provides: [
    ToolKind.of(
      defineTool({
        name: 'echo',
        description: 'Return the text that was passed in.',
        parameters: EchoArgs,
        execute: (input: { readonly text: string }) =>
          Effect.succeed(JSON.stringify({ echoed: input.text })),
      }),
    ),
  ],
})

/** The vendored pi, the user's own account, and a temporary session dir. */
const e2eEnv = (dir: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ORU_PI_COMMAND: process.execPath,
  ORU_PI_ARGS: JSON.stringify([PI_CLI]),
  ORU_PI_SESSION_DIR: join(dir, 'sessions'),
})

interface E2EReadiness {
  readonly run: boolean
  readonly reason: string
}

const readiness = await Effect.runPromise(
  Effect.gen(function* () {
    const dir = mkdtempSync(join(tmpdir(), 'oru-pi-e2e-probe-'))
    const probe = makePiHarness({ env: e2eEnv(dir), log: () => undefined })
    try {
      const health = yield* probe.service.health!()
      if (health.status !== 'ready') {
        return { run: false, reason: `pi is ${health.status}` } satisfies E2EReadiness
      }
      const models = yield* probe.service.listModels()
      if (!models.some((model) => model.id === MODEL)) {
        return { run: false, reason: `pi offers no model ${MODEL}` } satisfies E2EReadiness
      }
      return { run: true, reason: '' } satisfies E2EReadiness
    } finally {
      probe.shutdown()
      rmSync(dir, { recursive: true, force: true })
    }
  }).pipe(
    Effect.catch((cause) =>
      Effect.succeed({ run: false, reason: String(cause) } satisfies E2EReadiness),
    ),
  ),
)

if (!readiness.run) {
  process.stdout.write(`pi e2e skipped: ${readiness.reason}\n`)
}

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const sessionsDir = (dir: string): string => join(dir, 'sessions')

const bridge = (dir: string): PiHarness => {
  const harness = makePiHarness({
    env: e2eEnv(dir),
    log: (message) => process.stdout.write(`pi: ${message}\n`),
  })
  cleanups.push(() => {
    harness.shutdown()
  })
  return harness
}

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | Scope.Scope | SessionLog>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

const approveAll = (inference: Inference['Service']) =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const live = yield* log.subscribe
    yield* live.pipe(
      Stream.runForEach((event) =>
        Predicate.isTagged(event, 'tool/requested')
          ? inference.decide(event.thread, event.call, 'approve').pipe(Effect.orDie)
          : Effect.void,
      ),
      Effect.forkScoped,
    )
  })

const newId = Effect.sync(() => crypto.randomUUID())

const openThread = (cwd: string) =>
  Effect.gen(function* () {
    const log = yield* SessionLog
    const project = yield* newId
    yield* log.write(
      ProjectCreated.make({ ...unsignedTree, id: yield* newId, project, name: 'e2e', cwd }),
    )
    const thread = yield* newId
    yield* log.write(ThreadCreated.make({ ...unsignedTree, id: yield* newId, thread, project }))
    return thread
  })

const threadFacts = (events: readonly SessionEvent[], thread: string): readonly SessionEvent[] =>
  events.filter((event) =>
    Match.value(event).pipe(
      Match.tagsExhaustive({
        'plugin/activated': () => false,
        'plugin/deactivated': () => false,
        'project/created': () => false,
        'project/updated': () => false,
        'thread/created': (event) => event.thread === thread,
        'thread/configured': (event) => event.thread === thread,
        'thread/compacted': (event) => event.thread === thread,
        'thread/branched': (event) => event.thread === thread,
        'agent/inbox/spliced': (event) => event.thread === thread,
        'turn/started': (event) => event.thread === thread,
        'turn/failed': (event) => event.thread === thread,
        'turn/usage': (event) => event.thread === thread,
        'thread/context-window': (event) => event.thread === thread,
        'message/appended': (event) => event.thread === thread,
        'tool/requested': (event) => event.thread === thread,
        'approval/decided': (event) => event.thread === thread,
        'tool/completed': (event) => event.thread === thread,
      }),
    ),
  )

const transcriptOf = (events: readonly SessionEvent[]): readonly string[] =>
  events.flatMap((event) =>
    Predicate.isTagged(event, 'message/appended') ? [`${event.role}: ${event.body}`] : [],
  )

describe.runIf(readiness.run)('oru driving pi, for real', () => {
  it('runs a turn in a real pi process and records what happened', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oru-pi-e2e-'))
    const cwd = mkdtempSync(join(tmpdir(), 'oru-pi-e2e-cwd-'))
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true })
      rmSync(cwd, { recursive: true, force: true })
    })
    const harness = bridge(dir)

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost([
          harnessRegistryPlugin,
          echoToolPlugin,
          harnessPiPlugin(harness),
          inferencePlugin,
        ])
        const registry = yield* host.service(Harnesses)
        const entry = Option.getOrThrow(yield* registry.get('pi'))
        expect(entry.harness.health).toBeDefined()
        if (entry.harness.health === undefined) return
        // The guard already proved this; the turn is only worth running on it.
        const health = yield* entry.harness.health()
        expect(health.status).toBe('ready')

        const inference = yield* host.service(Inference)
        const log = yield* SessionLog
        const thread = yield* openThread(cwd)

        yield* inference.configure(thread, { harness: 'pi', model: MODEL })
        yield* approveAll(inference)
        yield* inference.send(thread, PROMPT)
        yield* inference.whenIdle(thread)

        const events = threadFacts(yield* log.entries, thread)
        process.stdout.write(`${events.map((event) => event._tag).join(' ')}\n`)
        process.stdout.write(`${transcriptOf(events).join('\n')}\n`)
        const failed = events.find((event) => Predicate.isTagged(event, 'turn/failed'))
        if (Predicate.isTagged(failed, 'turn/failed'))
          process.stdout.write(`turn failed: ${failed.reason}\n`)

        // The model answered through pi, and its answer is oru's fact.
        expect(failed).toBeUndefined()
        expect(
          events.some(
            (event) => Predicate.isTagged(event, 'message/appended') && event.role === 'assistant',
          ),
        ).toBe(true)
        expect(
          transcriptOf(events).some(
            (line) => line.startsWith('assistant: ') && line.length > 'assistant: '.length,
          ),
        ).toBe(true)

        // It was told to call oru's tool, so pi called it, oru ran it, and the
        // outcome is a fact rather than work left pending.
        const requested = events.find((event) => Predicate.isTagged(event, 'tool/requested'))
        const completed = events.find((event) => Predicate.isTagged(event, 'tool/completed'))
        expect(Predicate.isTagged(requested, 'tool/requested') ? requested.name : undefined).toBe(
          'echo',
        )
        expect(Predicate.isTagged(completed, 'tool/completed') ? completed.ok : undefined).toBe(
          true,
        )
        expect(Predicate.isTagged(completed, 'tool/completed') ? completed.result : '').toContain(
          'oru e2e',
        )
        expect(workOf(foldThread(yield* log.entries, thread))).toEqual(Idle.make({}))

        // pi keeps its own session for the thread, where the bridge told it to.
        const sessionFile = join(sessionsDir(dir), `${thread}.jsonl`)
        expect(existsSync(sessionFile)).toBe(true)
        expect(readFileSync(sessionFile, 'utf8')).toContain('"type":"session"')
      }),
    )
  })
})
