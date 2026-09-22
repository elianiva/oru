import { Effect, type Schema, Stream } from 'effect'
import type { SessionLogOutput } from '@opencode/client/effect/api'
import type { OpenCodeEvent } from '@opencode/client/effect'
import { HarnessError } from '@oru/harness'
import type { OpenCodePort } from '../src/opencode/port.ts'
import { openOpencodeHarness, type OpenedHarness } from '../src/opencode/host.ts'

/** A port call the bridge should never make in a test. */
export const unstubbed = (op: string) => (): Effect.Effect<never, HarnessError> =>
  Effect.fail(new HarnessError({ message: `unstubbed port call: ${op}`, code: 'unstubbed' }))

/** A port with every operation failing until overridden. */
export const stubPort = (overrides: Partial<OpenCodePort> = {}): OpenCodePort => ({
  getSession: unstubbed('session.get'),
  createSession: unstubbed('session.create'),
  prompt: unstubbed('session.prompt'),
  log: () =>
    Stream.fail(
      new HarnessError({ message: 'unstubbed port call: session.log', code: 'unstubbed' }),
    ),
  subscribe: () =>
    Stream.fail(
      new HarnessError({ message: 'unstubbed port call: event.subscribe', code: 'unstubbed' }),
    ),
  messages: unstubbed('message.list'),
  interrupt: unstubbed('session.interrupt'),
  switchModel: unstubbed('session.switchModel'),
  moveSession: unstubbed('session.move'),
  removeSession: unstubbed('session.remove'),
  forkSession: unstubbed('session.fork'),
  exportSession: unstubbed('session.export'),
  importSession: unstubbed('session.import'),
  compact: unstubbed('session.compact'),
  putInstruction: unstubbed('session.instructions.put'),
  removeInstruction: unstubbed('session.instructions.remove'),
  models: unstubbed('model.list'),
  defaultModel: unstubbed('model.default'),
  providers: unstubbed('provider.list'),
  agents: unstubbed('agent.list'),
  registerPlugin: unstubbed('plugin.register'),
  ...overrides,
})

export const openService = (port: OpenCodePort): Promise<OpenedHarness> =>
  Effect.runPromise(Effect.scoped(openOpencodeHarness({ port })))

// The envelope is the log's, never the bridge's: the switch reads `type` and
// `data`, so a fixture spells out only what a case asserts on. Each payload is
// JSON by construction, and the single assertion only recovers the envelope
// the projection never spells out in full.
// SAFETY: fixtures carry the envelope fields the translator switches on (type plus data); remaining fields are never read, so narrowing to the log output recovers the test double without re-checking the shape.
export const durable = (type: string, data: Record<string, Schema.Json>): SessionLogOutput =>
  ({
    id: 'evt_log',
    created: 1,
    type,
    durable: { aggregateID: 'ses_1', seq: 1, version: 1 },
    data,
  }) as SessionLogOutput

// SAFETY: a synced marker is only its type, aggregate, and optional cursor; the assertion recovers that narrow variant for the feed under test.
export const synced = (seq?: number): SessionLogOutput =>
  seq === undefined
    ? ({ type: 'log.synced', aggregateID: 'ses_1' } as SessionLogOutput)
    : ({ type: 'log.synced', aggregateID: 'ses_1', seq } as SessionLogOutput)

// SAFETY: bus fixtures carry the fragment fields the translator reads (type plus data); the assertion recovers the bus envelope without re-checking it.
export const ephemeral = (type: string, data: Record<string, Schema.Json>): OpenCodeEvent =>
  ({ id: 'evt_bus', created: 2, type, data }) as OpenCodeEvent
