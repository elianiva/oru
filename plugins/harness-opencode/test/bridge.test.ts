import { DateTime, Effect, Predicate, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import type {
  AgentListOutput,
  MessageListOutput,
  SessionLogOutput,
} from '@opencode/client/effect/api'
import type { OpenCodeEvent } from '@opencode/client/effect'
import { Session } from '@opencode/schema/session'
import { SessionMessage } from '@opencode/schema/session-message'
import { Agent } from '@opencode/schema/agent'
import { Model } from '@opencode/schema/model'
import { Provider } from '@opencode/schema/provider'
import { Project } from '@opencode/schema/project'
import { Money } from '@opencode/schema/money'
import { Tool } from '@opencode/schema/tool'
import { AbsolutePath } from '@opencode/schema/schema'
import type { ToolEditor } from '@opencode/plugin/effect/tool'
import { HarnessError, type HarnessTurnRequest, type ToolContributionLike } from '@oru/harness'
import { syncToolsOf } from '../src/opencode/host.ts'
import type { OpenCodePort, SessionImportInput } from '../src/opencode/port.ts'
import { abortThread, steerThread, type BoundTurn } from '../src/opencode/turn.ts'
import { durable, ephemeral, openService, stubPort, synced } from './fake.ts'

/**
 * The bridge against a scripted port: no host opens, no model answers.
 *
 * What is proven is the policy the unit modules cannot state alone — the seed
 * crosses once and never again, the turn window opens at its own execution,
 * the record assembles from the minted prompt id, steering fails so the
 * runtime queues, and oru tools sync by signature. The scripts are canned
 * event lists, because the reconciliation is what is under test, not
 * OpenCode's runtime.
 */

// The store keeps the narrow session fields the bridge reads; the fixture
// carries every required field, so no narrowing is needed.
// SAFETY: test thread ids are opaque keys the bridge equates with session ids; the brand records that convention without parsing.
const infoOf = (id: string, cwd: string): Session.Info => ({
  id: id as Session.ID,
  projectID: Project.ID.make('oru'),
  cost: Money.USD.make(0),
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(1), updated: DateTime.makeUnsafe(1) },
  location: { directory: AbsolutePath.make(cwd) },
})

// SAFETY: fixture message ids are opaque keys in the recorded session; the brand records that without parsing.
const message = (id: string, text: string): SessionMessage.Info => ({
  type: 'user',
  id: id as SessionMessage.ID,
  time: { created: DateTime.makeUnsafe(2) },
  text,
})

const assistantMessage = (id: string, text: string): SessionMessage.Info => ({
  type: 'assistant',
  // SAFETY: fixture message ids are opaque keys in the recorded session; the brand records that without parsing.
  id: id as SessionMessage.ID,
  time: { created: DateTime.makeUnsafe(3) },
  agent: Agent.ID.make('build'),
  model: {
    id: Model.ID.make('m'),
    providerID: Provider.ID.make('acme'),
  },
  content: [{ type: 'text', text }],
  tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
})

// The seed only reads the agent ids off the catalogue.
const agents: AgentListOutput = {
  location: { directory: AbsolutePath.make('/repo') },
  data: [Agent.Info.default(Agent.ID.make('build'))],
}

const started = durable('session.execution.started', {})
const succeeded = durable('session.execution.succeeded', {})

interface PromptCall {
  readonly threadId: string
  readonly messageID: string
  readonly text: string
  readonly delivery: string | undefined
}

/** A port with an in-memory session store and per-call event scripts. */
const scripted = (scripts: {
  readonly log: SessionLogOutput[][]
  readonly bus?: OpenCodeEvent[][]
  readonly replies?: SessionMessage.Info[][]
}) => {
  const store = new Map<string, { info: Session.Info; messages: SessionMessage.Info[] }>()
  const imports: SessionImportInput[] = []
  const prompts: PromptCall[] = []
  const logAfters: (number | undefined)[] = []
  const interrupts: string[] = []
  let calls = 0
  const port = stubPort({
    getSession: (threadId) => Effect.succeed(store.get(threadId)?.info),
    createSession: (input) =>
      input.model === undefined
        ? Effect.succeed(infoOf(input.threadId, input.cwd))
        : Effect.succeed(
            Object.assign({}, infoOf(input.threadId, input.cwd), { model: input.model }),
          ),
    importSession: (snapshot) =>
      Effect.sync(() => {
        imports.push(snapshot)
        const info = snapshot.info
        store.set(info.id, { info, messages: [...snapshot.messages] })
        return info
      }),
    prompt: (input) =>
      Effect.sync(() => {
        prompts.push({
          threadId: input.threadId,
          messageID: String(input.messageID),
          text: input.text,
          delivery: input.delivery,
        })
      }),
    exportSession: (threadId) => {
      const found = store.get(threadId)
      return found === undefined
        ? Effect.fail(
            new HarnessError({ message: `no session for thread ${threadId}`, code: 'missing' }),
          )
        : Effect.succeed({ info: found.info, messages: found.messages })
    },
    removeSession: (threadId) =>
      Effect.sync(() => {
        store.delete(threadId)
      }),
    putInstruction: () => Effect.void,
    removeInstruction: () => Effect.void,
    log: (input) => {
      logAfters.push(input.after)
      return Stream.fromIterable(scripts.log[calls] ?? [])
    },
    subscribe: () => Stream.fromIterable((scripts.bus ?? [])[calls] ?? []),
    messages: (threadId) => {
      const call = calls
      const reply = scripts.replies?.[call] ?? []
      const prompt = [...prompts].reverse().find((call) => call.threadId === threadId)
      const data = prompt === undefined ? reply : [message(prompt.messageID, prompt.text), ...reply]
      // SAFETY: the feed only reads the message list off the reply; the cursor is never consulted, so narrowing recovers the recorded listing.
      return Effect.succeed({ data, cursor: {} } as MessageListOutput)
    },
    interrupt: (threadId) =>
      Effect.sync(() => {
        interrupts.push(threadId)
      }),
    defaultModel: () => Effect.succeed(undefined),
    agents: () => Effect.succeed(agents),
  })
  const afterTurn = (): void => {
    calls += 1
  }
  return { port, store, imports, prompts, logAfters, interrupts, afterTurn }
}

const requestOf = (history: HarnessTurnRequest['history']): HarnessTurnRequest => ({
  threadId: 't1',
  history,
  model: undefined,
  cwd: '/repo',
})

const collect = (port: OpenCodePort, request: HarnessTurnRequest) =>
  openService(port).then((harness) =>
    Effect.runPromise(
      harness.service.streamTurn(request).pipe(
        Stream.runCollect,
        Effect.map((chunk) => [...chunk]),
      ),
    ),
  )

describe('seeding', () => {
  it('imports the history once, without the prompt being sent, and never again', async () => {
    const fake = scripted({
      log: [
        [synced(3), started, succeeded],
        [synced(5), started, succeeded],
      ],
    })
    const history: HarnessTurnRequest['history'] = [
      { type: 'user_message', text: 'earlier' },
      { type: 'assistant_message', text: 'prior' },
      { type: 'user_message', text: 'go' },
    ]
    // One service for both turns: cursors live on the host, so the second
    // turn resumes from the first turn's watermark.
    const harness = await openService(fake.port)
    const run = () =>
      Effect.runPromise(
        harness.service.streamTurn(requestOf(history)).pipe(
          Stream.runCollect,
          Effect.map((chunk) => [...chunk]),
        ),
      )
    const first = await run()
    fake.afterTurn()
    const second = await run()

    expect(fake.imports).toHaveLength(1)
    expect(fake.imports[0]?.messages.map((item) => item.type)).toEqual(['user', 'assistant'])
    expect(
      fake.imports[0]?.messages.map((item) =>
        item.type === 'user' || item.type === 'synthetic' ? item.text : null,
      ),
    ).toContain('earlier')
    expect(fake.prompts.map((prompt) => prompt.text)).toEqual(['go', 'go'])
    expect(fake.logAfters).toEqual([undefined, 3])
    expect(first.filter((event) => Predicate.isTagged(event, 'TurnComplete'))).toHaveLength(1)
    expect(second.filter((event) => Predicate.isTagged(event, 'TurnComplete'))).toHaveLength(1)
  })

  it('fails a history that does not end in a prompt', async () => {
    const fake = scripted({ log: [[]] })
    const harness = await openService(fake.port)
    const failure = await Effect.runPromise(
      harness.service
        .streamTurn(requestOf([{ type: 'assistant_message', text: 'stale' }]))
        .pipe(Stream.runCollect, Effect.flip),
    )
    expect(failure.code).toBe('malformed_history')
  })
})

describe('a turn', () => {
  it('streams deltas, then assembles the record from the minted prompt', async () => {
    const fake = scripted({
      log: [
        [
          started,
          durable('session.text.ended', { assistantMessageID: 'msg_a', ordinal: 0, text: 'Hello' }),
          durable('session.step.ended', {
            assistantMessageID: 'msg_a',
            tokens: { input: 50, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
          succeeded,
        ],
      ],
      bus: [
        [
          ephemeral('session.text.delta', {
            sessionID: 't1',
            assistantMessageID: 'msg_a',
            ordinal: 0,
            delta: 'Hel',
          }),
        ],
      ],
      replies: [[assistantMessage('msg_a', 'Hello')]],
    })
    const events = await collect(fake.port, requestOf([{ type: 'user_message', text: 'hi' }]))

    const complete = events[events.length - 1]
    expect(complete?._tag).toBe('TurnComplete')
    const deltas = events
      .flatMap((event) => (Predicate.isTagged(event, 'TextDelta') ? [event.text] : []))
      .sort()
    expect(deltas).toEqual(['Hel', 'lo'])
    if (complete !== undefined && Predicate.isTagged(complete, 'TurnComplete')) {
      expect(complete.turn.items).toEqual([
        { type: 'user_message', text: 'hi' },
        { type: 'assistant_message', text: 'Hello' },
      ])
      expect(complete.turn.usage).toEqual({
        input_tokens: 50,
        output_tokens: 5,
        total_tokens: 55,
        cost: 0,
      })
    } else {
      expect.fail('the bridge reported no turn')
    }
  })

  it('ignores a terminal the replay carried from an older turn', async () => {
    const fake = scripted({
      log: [[succeeded, synced(4), started, succeeded]],
    })
    const events = await collect(fake.port, requestOf([{ type: 'user_message', text: 'hi' }]))
    // One terminal ends the turn: the replayed one is dropped for want of a
    // window, the live one completes it.
    expect(events.filter((event) => Predicate.isTagged(event, 'TurnComplete'))).toHaveLength(1)
    expect(fake.logAfters).toEqual([undefined])
  })
})

describe('steering and aborting', () => {
  const hostOf = (port: OpenCodePort, threadId: string | undefined) => ({
    port,
    active: new Map(threadId === undefined ? [] : [[threadId, { promptMessageID: 'msg_p' }]]),
  })

  it('steers into the running turn and queues when idle', async () => {
    const fake = scripted({ log: [[]] })
    await Effect.runPromise(steerThread(hostOf(fake.port, 't1'), 't1', 'more'))
    expect(
      fake.prompts.map((prompt) => ({
        threadId: prompt.threadId,
        text: prompt.text,
        delivery: prompt.delivery,
      })),
    ).toEqual([{ threadId: 't1', text: 'more', delivery: 'steer' }])
    const idle = await Effect.runPromise(
      Effect.flip(steerThread(hostOf(fake.port, undefined), 't1', 'more')),
    )
    expect(idle.code).toBe('no_active_turn')
  })

  it('interrupts the running turn and reports an idle abort', async () => {
    const fake = scripted({ log: [[]] })
    await Effect.runPromise(abortThread(hostOf(fake.port, 't1'), 't1'))
    expect(fake.interrupts).toEqual(['t1'])
    const idle = await Effect.runPromise(
      Effect.flip(abortThread(hostOf(fake.port, undefined), 't1')),
    )
    expect(idle.code).toBe('aborted')
  })
})

describe('forking and compacting', () => {
  it('copies the source at the checkpoint with lineage', async () => {
    const fake = scripted({ log: [[]] })
    fake.store.set('a', {
      info: infoOf('a', '/repo'),
      messages: [message('ma', 'one'), message('mb', 'two')],
    })
    const harness = await openService(fake.port)
    const fork = harness.service.fork
    if (fork === undefined) expect.fail('fork is not implemented')
    await Effect.runPromise(fork({ sourceThreadId: 'a', targetThreadId: 'b', checkpoint: 'ma' }))
    const target = fake.store.get('b')
    expect(target?.messages.map((item) => item.id)).toEqual(['ma'])
    expect(target?.info.fork).toMatchObject({ sessionID: 'a' })
  })

  it('compacts and reads back the summary, refusing instructions', async () => {
    let compacted = 0
    const port = stubPort({
      getSession: (threadId) => Effect.succeed(infoOf(threadId, '/repo')),
      compact: () =>
        Effect.sync(() => {
          compacted += 1
        }),
      log: () =>
        Stream.fromIterable([
          synced(9),
          durable('session.compaction.ended', {
            reason: 'manual',
            model: 'acme/opus',
            providerContext: [],
            text: 'the summary',
            recent: 'none',
            cost: 0,
            tokens: { input: 700, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
        ]),
    })
    const harness = await openService(port)
    const compact = harness.service.compact
    if (compact === undefined) expect.fail('compact is not implemented')
    await expect(
      Effect.runPromise(compact({ threadId: 't', instructions: 'be brief' })),
    ).rejects.toMatchObject({ code: 'unsupported_operation' })
    expect(compacted).toBe(0)
    const compaction = await Effect.runPromise(compact({ threadId: 't' }))
    expect(compaction).toEqual({
      summary: 'the summary',
      tokensBefore: 700,
      readFiles: [],
      modifiedFiles: [],
    })
    expect(compacted).toBe(1)
  })
})

describe('syncing oru tools', () => {
  const tool = (name: string, description: string): ToolContributionLike => ({
    name,
    description,
    parameters: { type: 'object' },
  })

  const editorOf = () => {
    const added: Tool.Info[] = []
    const removed: string[] = []
    const editor: ToolEditor = {
      list: () => [],
      get: () => undefined,
      namespace: () => {},
      add: (candidate) => {
        added.push(candidate)
      },
      update: () => {},
      remove: (name) => {
        removed.push(name)
      },
    }
    return { editor, added, removed }
  }

  it('adds, replaces by signature, and removes what left', async () => {
    const { editor, added, removed } = editorOf()
    const bound = new Map<string, BoundTurn>()
    const managed = new Map<string, string>()
    const deps = { editor: () => editor, bound }
    await Effect.runPromise(syncToolsOf(deps, managed, [tool('read', 'reads')]))
    expect(added.map((candidate) => candidate.name)).toEqual(['read'])
    await Effect.runPromise(syncToolsOf(deps, managed, [tool('read', 'reads')]))
    expect(added).toHaveLength(1)
    await Effect.runPromise(syncToolsOf(deps, managed, [tool('read', 'reads files')]))
    expect(removed).toEqual(['read'])
    expect(added).toHaveLength(2)
    await Effect.runPromise(syncToolsOf(deps, managed, []))
    expect(removed).toEqual(['read', 'read'])
    expect(managed.size).toBe(0)
  })

  it('routes execution to the bound turn and honors denial', async () => {
    const { editor, added } = editorOf()
    const calls: { readonly name: string; readonly argumentsJson: string }[] = []
    let decision: 'approve' | 'deny' = 'approve'
    const bound = new Map<string, BoundTurn>([
      [
        's1',
        {
          executeTool: (input) => {
            calls.push(input)
            return Promise.resolve({ ok: true as const, result: 'file body' })
          },
          awaitToolApproval: () => Promise.resolve(decision),
          toolNames: new Set(['read']),
        },
      ],
    ])
    await Effect.runPromise(
      syncToolsOf({ editor: () => editor, bound }, new Map(), [tool('read', 'reads')]),
    )
    const candidate = added[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) expect.fail('tool was not added')
    const execute = candidate.execute
    const context: Tool.Context = {
      // SAFETY: the bound turn is keyed by the session the test scripted; the brand records that key without parsing.
      sessionID: 's1' as Session.ID,
      agent: Agent.ID.make('build'),
      messageID: SessionMessage.ID.make('msg_1'),
      id: Tool.CallID.make('call_1'),
      progress: () => Effect.void,
    }
    await expect(Effect.runPromise(execute({ path: 'x' }, context))).resolves.toEqual({
      content: 'file body',
    })
    expect(calls).toEqual([{ name: 'read', argumentsJson: '{"path":"x"}' }])
    decision = 'deny'
    const denied = await Effect.runPromise(Effect.flip(execute({ path: 'x' }, context)))
    expect(denied._tag).toBe('Tool.Error')
  })
})
