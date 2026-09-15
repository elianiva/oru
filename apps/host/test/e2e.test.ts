import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Effect, Fiber, Stream } from 'effect'
import {
  SCRIPTED_MODEL,
  startScriptedProvider,
  type ScriptedProvider,
} from '@oru/harness-pi/testing'
import { ThreadClient, clientsFor } from '@oru/rpc'
import { startedHost } from './spawn-host.ts'

/**
 * The whole product, over the real transport: the binary starts, a client
 * reaches it, and a real pi process runs a real turn.
 *
 * The scripted provider replaces the model endpoint and nothing else, so the pi
 * binary, its RPC dialect, its session file, the injected extension, and the
 * tool channel are all real. That run is hermetic and always on. The run that
 * spends a real account only happens when `ORU_PI_E2E_MODEL` names the model to
 * spend, and reports a skip otherwise, which is the convention the bridge's own
 * end-to-end test set.
 */
const REAL_MODEL = process.env.ORU_PI_E2E_MODEL

/** The scripted provider answers a tool prompt by calling that tool. */
const PROMPT = '/tool echo {"text":"oru e2e"}'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const scratchDir = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), name))
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

type TurnResult =
  | { readonly offered: false }
  | {
      readonly offered: true
      readonly threadId: string
      readonly tags: readonly string[]
      readonly assistant: readonly string[]
      readonly toolOk: boolean | undefined
      readonly toolResult: string
      readonly failed: string | undefined
    }

/** Drive one turn through the host a client reaches, the way the app does. */
const runTurn = (url: string, cwd: string, model: string): Promise<TurnResult> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* Effect.gen(function* () {
          const thread = yield* ThreadClient
          const created = yield* thread.create(cwd)
          const options = yield* thread.configure(created.threadId, {
            harness: 'pi',
            model,
            reasoning: undefined,
          })
          if (!options.models.some((entry) => entry.id === model)) {
            return { offered: false } satisfies TurnResult
          }

          const watching = yield* thread.watch(created.threadId).pipe(
            Stream.takeUntil(
              (event) =>
                event._tag === 'turn/failed' ||
                (event._tag === 'message/appended' && event.role === 'assistant'),
            ),
            Stream.runCollect,
            Effect.forkScoped,
          )
          yield* thread.watch(created.threadId).pipe(
            Stream.runForEach((event) =>
              event._tag === 'tool/requested'
                ? thread.decide(created.threadId, event.call, 'approve')
                : Effect.void,
            ),
            Effect.forkScoped,
          )
          yield* thread.send(created.threadId, PROMPT)
          const events = yield* Fiber.join(watching)

          const completed = events.find((event) => event._tag === 'tool/completed')
          const failed = events.find((event) => event._tag === 'turn/failed')
          return {
            offered: true,
            threadId: created.threadId,
            tags: events.map((event) => event._tag),
            assistant: events.flatMap((event) =>
              event._tag === 'message/appended' && event.role === 'assistant' ? [event.body] : [],
            ),
            toolOk: completed?._tag === 'tool/completed' ? completed.ok : undefined,
            toolResult: completed?._tag === 'tool/completed' ? completed.result : '',
            failed: failed?._tag === 'turn/failed' ? failed.reason : undefined,
          } satisfies TurnResult
        }).pipe(Effect.provide(clientsFor(url)))
      }),
    ),
  )

/** What the running host reports about pi, asked over the transport. */
const piHealth = (url: string): Promise<string> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* Effect.gen(function* () {
          const thread = yield* ThreadClient
          const created = yield* thread.create(process.cwd())
          const options = yield* thread.options(created.threadId)
          const pi = options.harnesses.find((choice) => choice.id === 'pi')
          return pi === undefined ? 'missing' : pi.health.status
        }).pipe(Effect.provide(clientsFor(url)))
      }),
    ),
  )

const TURN_FACTS = [
  'thread/created',
  'thread/configured',
  'message/appended',
  'agent/inbox/spliced',
  'turn/started',
  'tool/requested',
  'approval/decided',
  'tool/completed',
  'message/appended',
]

describe('a running host', () => {
  it('runs a pi turn over the wire and records the facts oru owns', async () => {
    const cwd = scratchDir('oru-host-e2e-cwd-')
    const scripted: ScriptedProvider = await startScriptedProvider()
    cleanups.push(async () => {
      await scripted.close()
    })

    const host = await startedHost(['--port', '0'], {
      ...scripted.env,
      ORU_HOME: scratchDir('oru-host-e2e-home-'),
      ORU_JOURNAL: join(scratchDir('oru-host-e2e-journal-'), 'journal.db'),
    })
    cleanups.push(() => host.stop())

    const sessions = scripted.env.ORU_PI_SESSION_DIR
    if (sessions === undefined) throw new Error('the scripted provider named no session directory')

    const turn = await runTurn(host.url, cwd, SCRIPTED_MODEL)
    expect(turn.offered).toBe(true)
    if (!turn.offered) return

    expect(turn.failed).toBeUndefined()
    expect(turn.tags).toEqual(TURN_FACTS)
    expect(turn.toolOk).toBe(true)
    expect(turn.toolResult).toContain('oru e2e')
    expect(turn.assistant.at(-1)).toContain('Tool said')

    // pi keeps its session for the thread where the host told it to, which only
    // holds if a real pi process ran the turn.
    const session = join(sessions, `${turn.threadId}.jsonl`)
    expect(existsSync(session)).toBe(true)
    expect(readFileSync(session, 'utf8')).toContain('"type":"session"')
  }, 120_000)

  it('runs a pi turn against the real model named by ORU_PI_E2E_MODEL', async (context) => {
    if (REAL_MODEL === undefined) {
      context.skip('ORU_PI_E2E_MODEL names no model to spend')
      return
    }

    const cwd = scratchDir('oru-host-live-cwd-')
    const scratch = scratchDir('oru-host-live-')
    const host = await startedHost(['--port', '0'], {
      ...process.env,
      ORU_HOME: scratch,
      ORU_JOURNAL: join(scratch, 'journal.db'),
      // The account and the model are the user's; the session is a temp file,
      // so the run never touches their own threads.
      ORU_PI_SESSION_DIR: join(scratch, 'sessions'),
    })
    cleanups.push(() => host.stop())

    const health = await piHealth(host.url)
    if (health !== 'ready') {
      context.skip(`pi is ${health}`)
      return
    }

    const turn = await runTurn(host.url, cwd, REAL_MODEL)
    if (!turn.offered) {
      context.skip(`pi offers no model ${REAL_MODEL}`)
      return
    }

    expect(turn.failed).toBeUndefined()
    expect(turn.tags).toEqual(TURN_FACTS)
    expect(turn.toolOk).toBe(true)
    expect(turn.assistant.some((line) => line.length > 0)).toBe(true)
  }, 180_000)
})
