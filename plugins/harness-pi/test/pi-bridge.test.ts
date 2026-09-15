import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Predicate, Effect, Result, Schema, Stream } from 'effect'
import * as Items from '@effect-uai/core/Items'
import * as Tool from '@effect-uai/core/Tool'
import * as Toolkit from '@effect-uai/core/Toolkit'
import * as Turn from '@effect-uai/core/Turn'
import { HarnessError, type HarnessEvent, type HarnessTurnRequest } from '@oru/harness'
import { makePiHarness, type PiHarness } from '../src/index.ts'
import {
  SCRIPTED_MINI,
  SCRIPTED_MODEL,
  startScriptedProvider,
  type ScriptedFunctionTool,
  type ScriptedProvider,
} from './scripted-provider.ts'

/**
 * The bridge against a real pi with a scripted model.
 *
 * `test/scripted-provider.ts` answers pi's provider calls the way a declared
 * OpenAI-compatible endpoint would, so these tests exercise the real path:
 * spawn, ready gate, session file, event translation, tool channel, and
 * everything the runtime records. What the model says is scripted; nothing
 * else is.
 */

const MODEL = SCRIPTED_MODEL
const ECHO_ARGS = Schema.Struct({ text: Schema.String })

/** What pi offered the model for a tool: a name, a description, a JSON Schema. */
const PiOfferedTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  parameters: Schema.Struct({
    type: Schema.String,
    properties: Schema.Struct({
      text: Schema.Struct({ type: Schema.String }),
    }),
    required: Schema.Array(Schema.String),
  }),
})

/**
 * The harness failure behind a result, with the tag proven first. A turn can
 * fail for reasons outside the harness (a provider disappearing mid-run), and
 * this keeps such a failure from being read as a `HarnessError`.
 */
const harnessErrorOf = <A, E>(result: Result.Result<A, E>): HarnessError => {
  if (Result.isFailure(result) && result.failure instanceof HarnessError) return result.failure
  expect.fail(`expected a harness failure, got ${String(result)}`)
}

interface Bridge {
  readonly pi: PiHarness
  readonly scripted: ScriptedProvider
  readonly dir: string
}

const built: Bridge[] = []

const bridge = async (
  overrides: Readonly<Record<string, string>> = {},
  scriptedOptions: { readonly piVersion?: string | undefined } = {},
): Promise<Bridge> => {
  const scripted = await startScriptedProvider(scriptedOptions)
  const pi = makePiHarness({
    env: { ...scripted.env, ...overrides },
    // The bridge talks to people through oru; a test has no one to tell.
    log: () => undefined,
  })
  const created = { pi, scripted, dir: scripted.dir }
  built.push(created)
  return created
}

afterEach(async () => {
  for (const entry of built.splice(0)) {
    entry.pi.shutdown()
    await entry.scripted.close()
    rmSync(entry.dir, { recursive: true, force: true })
  }
})

/**
 * What pi reported about a tool it ran, with the tag proven first: the bridge
 * forwards this, it does not invent it.
 */
const toolResultOf = (collected: readonly HarnessEvent[]) => {
  const found = collected.find((event) => Predicate.isTagged(event, 'ToolResult'))
  if (!Predicate.isTagged(found, 'ToolResult')) expect.fail('the bridge reported no tool result')
  return {
    call_id: found.call_id,
    name: found.name,
    ok: found.ok,
    result: found.result,
  }
}

const sessionFile = (entry: Bridge, threadId: string): string =>
  join(entry.dir, 'sessions', `${threadId}.jsonl`)

const request = (
  threadId: string,
  text: string,
  extra: Partial<HarnessTurnRequest> = {},
): HarnessTurnRequest => ({
  threadId,
  history: [Items.userText(text)],
  model: MODEL,
  ...extra,
})

const events = (entry: Bridge, turn: HarnessTurnRequest): Promise<readonly HarnessEvent[]> =>
  Effect.runPromise(Stream.runCollect(entry.pi.service.streamTurn(turn)))

const echoToolkit = () =>
  Toolkit.fromArray([
    Tool.make({
      name: 'echo',
      description: 'Return the text that was passed in.',
      inputSchema: Tool.fromEffectSchema(ECHO_ARGS),
      run: (input) => Effect.succeed({ echoed: input.text }),
    }),
  ])

const tagOf = (event: HarnessEvent): string => event._tag

const turnOf = (collected: readonly HarnessEvent[]): Turn.Turn => {
  for (const event of collected) {
    if (Predicate.isTagged(event, 'TurnComplete')) return event.turn
  }
  expect.fail('the bridge reported no turn')
}

/** What the model saw for a tool: pi forwards oru's JSON Schema, as declared. */
const offeredTool = (
  offered: readonly ScriptedFunctionTool[],
  name: string,
): { readonly name: string; readonly description: unknown; readonly parameters: unknown } => {
  const found = offered.find((tool) => tool.name === name)
  if (found === undefined) expect.fail(`pi offered no tool ${name}`)
  return found
}

describe('pi catalogue and health', () => {
  it('lists pi models in the provider/id form a turn passes back, with pi thinking levels', async () => {
    const entry = await bridge()
    const models = await Effect.runPromise(entry.pi.service.listModels())
    expect(models.map((model) => model.id)).toEqual([SCRIPTED_MODEL, SCRIPTED_MINI])
    const [reasoning, plain] = models
    expect(reasoning?.isDefault).toBe(true)
    expect(reasoning?.contextWindow).toBe(200_000)
    expect(reasoning?.reasoningLevels).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(plain?.reasoningLevels).toEqual(['off'])
  })

  it('reports health from the installed pi version', async () => {
    const entry = await bridge({}, { piVersion: '0.83.9' })
    const health = await Effect.runPromise(entry.pi.service.health!())
    expect(health.status).toBe('unsupported_version')
    expect(health.installedVersion).toBe('0.83.9')
    expect(health.minimumSupportedVersion).toBe('0.84.0')
    expect(health.installCommand).toBeDefined()
  })

  it('reports a missing pi instead of failing the thread', async () => {
    const entry = await bridge({ ORU_PI_COMMAND: '/nonexistent/pi-binary' })
    const health = await Effect.runPromise(entry.pi.service.health!())
    expect(health.status).toBe('not_installed')
  })
})

describe('pi turns', () => {
  it('runs a turn, reports live deltas, and assembles it from pi session', async () => {
    const entry = await bridge()
    const collected = await events(entry, request('t1', 'hi'))
    expect(collected.map(tagOf)).toContain('TextDelta')
    expect(collected.map(tagOf)).toContain('ContextWindow')

    const turn = turnOf(collected)
    expect(turn.items).toEqual([Items.assistantText('Response to: hi')])
    expect(turn.stop_reason).toBe('stop')
    expect(turn.usage.input_tokens).toBe(12)
    expect(turn.usage.output_tokens).toBe(5)

    // The prompt is pi's entry, not a fact the bridge repeats: the runtime
    // already recorded the user message it sent.
    const file = sessionFile(entry, 't1')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('Response to: hi')
  })

  it('seeds pi with the history the thread already had', async () => {
    const entry = await bridge()
    const history = [
      Items.userText('earlier question'),
      Items.assistantText('earlier answer'),
      Items.userText('hi'),
    ]
    await events(entry, { threadId: 'seeded', history, model: MODEL })
    const written = readFileSync(sessionFile(entry, 'seeded'), 'utf8')
    expect(written).toContain('earlier question')
    expect(written).toContain('earlier answer')
  })

  it('runs a tool oru contributed, through the extension pi loaded', async () => {
    const entry = await bridge()
    const collected = await events(
      entry,
      request('tools', '/tool echo {"text":"hi"}', { tools: echoToolkit() }),
    )
    expect(collected.map(tagOf)).toContain('ToolCallStart')
    // pi ran the call itself and said how it went: the runtime records the
    // outcome as a fact instead of guessing (ADR-0007).
    expect(toolResultOf(collected)).toEqual({
      call_id: 'call-1',
      name: 'echo',
      ok: true,
      result: '{"echoed":"hi"}',
    })
    // The call and its output are both in the turn, paired: that is what tells
    // the runtime the harness ran the tool itself (ADR-0007), and what lands in
    // oru's log as a requested/completed pair.
    expect(turnOf(collected).items).toEqual([
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'echo',
        arguments: '{"text":"hi"}',
      },
      Items.toolCallOutput('call-1', '{"echoed":"hi"}'),
      Items.assistantText('Tool said: {"echoed":"hi"}'),
    ])

    // What pi's model sees: oru's JSON Schema, converted.
    const registered = Schema.decodeUnknownSync(PiOfferedTool)(
      offeredTool(entry.scripted.toolsOfLastRequest(), 'echo'),
    )
    expect(registered.name).toBe('echo')
    expect(registered.description).toBe('Return the text that was passed in.')
    expect(registered.parameters.type).toBe('object')
    expect(registered.parameters.properties.text.type).toBe('string')
    expect(registered.parameters.required).toContain('text')
  })

  it('reports a tool that failed as a failed result, not as a happy one', async () => {
    const entry = await bridge()
    // `echo` is not registered here, so pi cannot run it: pi says so in the
    // result, and that is what the runtime records.
    const collected = await events(entry, request('failed-tool', '/tool echo {"text":"hi"}'))

    expect(toolResultOf(collected).ok).toBe(false)
    expect(toolResultOf(collected).result).toBe('Tool echo not found')
    // The failure is pi's report about a tool, not a failed turn: the run still
    // lands as an assembled turn.
    expect(turnOf(collected).stop_reason).toBe('stop')
  })

  it('reports a provider failure as a failed turn, after saying why', async () => {
    const entry = await bridge()
    const seen: string[] = []
    const failed = await Effect.runPromise(
      Effect.result(
        entry.pi.service.streamTurn(request('fail', '/fail')).pipe(
          Stream.tap((event) => Effect.sync(() => seen.push(tagOf(event)))),
          Stream.runDrain,
        ),
      ),
    )
    expect(seen).toContain('ProviderError')
    expect(Result.isFailure(failed)).toBe(true)
    if (Result.isFailure(failed)) {
      expect(harnessErrorOf(failed).code).toBe('turn_failed')
      expect(harnessErrorOf(failed).message).toContain('scripted run failure')
    }
  })

  it('refuses a turn that has nothing to prompt, instead of repeating the last one', async () => {
    const entry = await bridge()
    await events(entry, request('settled', 'hi'))
    const reply = await Effect.runPromise(
      Effect.result(
        entry.pi.service
          .streamTurn({
            threadId: 'settled',
            history: [Items.userText('hi'), Items.assistantText('Response to: hi')],
            model: MODEL,
          })
          .pipe(Stream.runDrain),
      ),
    )
    expect(Result.isFailure(reply)).toBe(true)
    if (Result.isFailure(reply)) {
      expect(harnessErrorOf(reply).code).toBe('no_prompt')
    }
  })

  it('steers a running turn and aborts one', async () => {
    const entry = await bridge()

    // A turn is only steerable once pi has taken the prompt, and the way to
    // know that is the provider's own request log. pi queues the steer and
    // delivers it after the running assistant message finishes, so the turn
    // assembles from both answers, with the steer recorded as the user
    // message the runtime never saw sent.
    const held = events(entry, request('steered', '/slow'))
    await entry.scripted.waitForRequests(1)
    await Effect.runPromise(entry.pi.service.steer!('steered', 'go left'))
    expect(turnOf(await held).items).toEqual([
      Items.assistantText('Slow answer streaming.'),
      Items.userText('go left'),
      Items.assistantText('Response to: go left'),
    ])

    // An aborted run has no assistant answer to record, and effect-uai has no
    // "cancelled" stop reason, so the turn fails with the reason instead.
    const stopped = Effect.runPromise(
      Effect.result(entry.pi.service.streamTurn(request('aborted', '/hold')).pipe(Stream.runDrain)),
    )
    await entry.scripted.waitForRequests(3)
    await Effect.runPromise(entry.pi.service.abort!('aborted'))
    const ended = await stopped
    expect(Result.isFailure(ended)).toBe(true)
    if (Result.isFailure(ended)) {
      expect(harnessErrorOf(ended).message).toContain('aborted')
    }
  })

  it('compacts a thread and reports what pi kept', async () => {
    const entry = await bridge()
    const note = join(entry.dir, 'note.md')
    writeFileSync(note, 'oru compaction note', 'utf8')
    // The read leaves a file operation in pi's session for the compaction to
    // report, and the two large turns leave an older turn for it to summarize.
    await events(entry, request('compacted', `/tool read {"path":${JSON.stringify(note)}}`))
    await events(entry, request('compacted', '/large-context'))
    await events(entry, request('compacted', '/large-context'))
    const compaction = await Effect.runPromise(
      entry.pi.service.compact!({ threadId: 'compacted', instructions: 'keep the gist' }),
    )
    expect(compaction.summary).toContain('Scripted summary (focus: keep the gist).')
    expect(compaction.readFiles).toEqual([note])
  })

  it('forks a thread into a new pi session', async () => {
    const entry = await bridge()
    await events(entry, request('source', 'hi'))
    await Effect.runPromise(
      entry.pi.service.fork!({
        sourceThreadId: 'source',
        targetThreadId: 'copy',
        cwd: entry.dir,
      }),
    )
    // pi copies through its own session API, so the new file is a real session
    // with the source's history in it, not a byte copy of the source.
    const forked = readFileSync(sessionFile(entry, 'copy'), 'utf8')
    expect(forked).toContain('Response to: hi')
    expect(forked).not.toBe(readFileSync(sessionFile(entry, 'source'), 'utf8'))
  })

  it('stops a thread without losing its session, and discards it on request', async () => {
    const entry = await bridge()
    await events(entry, request('released', 'hi'))
    await Effect.runPromise(entry.pi.service.stop!('released'))
    expect(existsSync(sessionFile(entry, 'released'))).toBe(true)

    // A stopped thread resumes: pi appends to the file it already has.
    await events(entry, request('released', 'again'))
    expect(readFileSync(sessionFile(entry, 'released'), 'utf8')).toContain('again')

    await Effect.runPromise(entry.pi.service.discard!('released'))
    expect(existsSync(sessionFile(entry, 'released'))).toBe(false)
  })

  it('replaces the pi child when the thread working directory changes', async () => {
    const entry = await bridge()
    const first = join(entry.dir, 'one')
    const second = join(entry.dir, 'two')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    await events(entry, request('moved', 'hi', { cwd: first }))
    const moved = await events(entry, request('moved', 'again', { cwd: second }))
    expect(moved.map(tagOf)).toContain('SessionReplaced')
  })

  it("turns pi's built-in tools off when the opt-out asks for it, and not otherwise", async () => {
    const ordinary = await bridge()
    await events(ordinary, request('builtins', 'hi', { tools: echoToolkit() }))
    // pi's own coding tools reach the model alongside oru's.
    const offered = ordinary.scripted.toolsOfLastRequest().map((tool) => tool.name)
    expect(offered).toContain('read')
    expect(offered).toContain('bash')
    expect(offered).toContain('echo')

    // The opt-out keeps the injected extension loaded: it is pi's own coding
    // tools the flag removes, not oru's.
    const opted = await bridge({ ORU_PI_NO_BUILTIN_TOOLS: '1' })
    await events(opted, request('opted', 'hi', { tools: echoToolkit() }))
    expect(opted.scripted.toolsOfLastRequest().map((tool) => tool.name)).toEqual(['echo'])
  })
})
