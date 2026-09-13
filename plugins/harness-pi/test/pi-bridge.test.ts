import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Effect, Result, Schema, Stream } from 'effect'
import * as Items from '@effect-uai/core/Items'
import * as Tool from '@effect-uai/core/Tool'
import * as Toolkit from '@effect-uai/core/Toolkit'
import * as Turn from '@effect-uai/core/Turn'
import { HarnessError, type HarnessEvent, type HarnessTurnRequest } from '@oru/harness'
import { makePiHarness, type PiHarness } from '../src/index.ts'

/**
 * The bridge against a scripted pi.
 *
 * `test/fake-pi.mjs` speaks pi's RPC dialect and loads the bridge's injected
 * extension the way pi loads it, over the same fds, so these tests exercise the
 * real path: spawn, ready gate, session file, event translation, tool channel,
 * and everything the runtime records.
 */

const FAKE_PI = fileURLToPath(new URL('./fake-pi.mjs', import.meta.url))
const MODEL = 'fake-provider/fake-model'
const ECHO_ARGS = Schema.Struct({ text: Schema.String })

/** What the bridge hands pi for a tool: a name, a description, a JSON Schema. */
const PiRegisteredTool = Schema.Struct({
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
  throw new Error(`expected a harness failure, got ${String(result)}`)
}

interface Bridge {
  readonly pi: PiHarness
  readonly dir: string
}

const built: Bridge[] = []

const bridge = (
  overrides: Readonly<Record<string, string>> = {},
  argvDumpOf?: (dir: string) => string,
): Bridge => {
  const dir = mkdtempSync(join(tmpdir(), 'oru-pi-'))
  const env = {
    ...process.env,
    ORU_PI_COMMAND: process.execPath,
    ORU_PI_ARGS: JSON.stringify([FAKE_PI]),
    ORU_PI_SESSION_DIR: join(dir, 'sessions'),
    FAKE_PI_VERSION: '0.84.0',
    ...overrides,
  }
  const pi = makePiHarness({
    env: argvDumpOf === undefined ? env : { ...env, FAKE_PI_ARGV_DUMP: argvDumpOf(dir) },
    // The bridge talks to people through oru; a test has no one to tell.
    log: () => undefined,
  })
  const created = { pi, dir }
  built.push(created)
  return created
}

afterEach(() => {
  for (const entry of built.splice(0)) {
    entry.pi.shutdown()
    rmSync(entry.dir, { recursive: true, force: true })
  }
})

/**
 * What pi reported about a tool it ran, with the tag proven first: the bridge
 * forwards this, it does not invent it.
 */
const toolResultOf = (collected: readonly HarnessEvent[]) => {
  const found = collected.find((event) => event._tag === 'ToolResult')
  if (found?._tag !== 'ToolResult') throw new Error('the bridge reported no tool result')
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

/**
 * A turn that stays open is only steerable once pi has taken the prompt, and
 * the way to know that is pi's own command log.
 */
const waitForModes = (file: string, mode: string, count: number): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (;;) {
        const seen = existsSync(file)
          ? readFileSync(file, 'utf8')
              .split('\n')
              .filter((line) => line === mode).length
          : 0
        if (seen >= count) return
        yield* Effect.sleep('20 millis')
      }
    }).pipe(Effect.timeout('10 seconds')),
  )

const turnOf = (collected: readonly HarnessEvent[]): Turn.Turn => {
  for (const event of collected) {
    if (event._tag === 'TurnComplete') return event.turn
  }
  throw new Error('the bridge reported no turn')
}

describe('pi catalogue and health', () => {
  it('lists pi models in the provider/id form a turn passes back, with pi thinking levels', async () => {
    const entry = bridge()
    const models = await Effect.runPromise(entry.pi.service.listModels())
    expect(models.map((model) => model.id)).toEqual([
      'fake-provider/fake-model',
      'fake-provider/fake-mini',
    ])
    const [reasoning, plain] = models
    expect(reasoning?.isDefault).toBe(true)
    expect(reasoning?.contextWindow).toBe(200_000)
    expect(reasoning?.reasoningLevels).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
    expect(plain?.reasoningLevels).toEqual(['off'])
  })

  it('reports health from the installed pi version', async () => {
    const entry = bridge({ FAKE_PI_VERSION: '0.83.9' })
    const health = await Effect.runPromise(entry.pi.service.health!())
    expect(health.status).toBe('unsupported_version')
    expect(health.installedVersion).toBe('0.83.9')
    expect(health.minimumSupportedVersion).toBe('0.84.0')
    expect(health.installCommand).toBeDefined()
  })

  it('reports a missing pi instead of failing the thread', async () => {
    const entry = bridge({ ORU_PI_COMMAND: '/nonexistent/pi-binary' })
    const health = await Effect.runPromise(entry.pi.service.health!())
    expect(health.status).toBe('not_installed')
  })
})

describe('pi turns', () => {
  it('runs a turn, reports live deltas, and assembles it from pi session', async () => {
    const entry = bridge()
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
    const entry = bridge()
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
    const dump = join(tmpdir(), `oru-pi-tools-${Date.now().toString(36)}.json`)
    const entry = bridge({ FAKE_PI_TOOLS_DUMP: dump })
    const collected = await events(
      entry,
      request('tools', '/tool echo {"text":"hi"}', { tools: echoToolkit() }),
    )
    expect(collected.map(tagOf)).toContain('ToolCallStart')
    // pi ran the call itself and said how it went: the runtime records the
    // outcome as a fact instead of guessing (ADR-0022).
    expect(toolResultOf(collected)).toEqual({
      call_id: 'call-1',
      name: 'echo',
      ok: true,
      result: '{"echoed":"hi"}',
    })
    // The call and its output are both in the turn, paired: that is what tells
    // the runtime the harness ran the tool itself (ADR-0022), and what lands in
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
    const registered = Schema.decodeUnknownSync(PiRegisteredTool)(
      JSON.parse(readFileSync(dump, 'utf8').trim()),
    )
    expect(registered.name).toBe('echo')
    expect(registered.description).toBe('Return the text that was passed in.')
    expect(registered.parameters.type).toBe('object')
    expect(registered.parameters.properties.text.type).toBe('string')
    expect(registered.parameters.required).toContain('text')
    rmSync(dump, { force: true })
  })

  it('reports a tool that failed as a failed result, not as a happy one', async () => {
    const entry = bridge()
    // `echo` is not registered here, so the extension cannot run it: pi says so
    // in the result, and that is what the runtime records.
    const collected = await events(entry, request('failed-tool', '/tool echo {"text":"hi"}'))

    expect(toolResultOf(collected).ok).toBe(false)
    expect(toolResultOf(collected).result).toBe('no tool echo')
    // The failure is pi's report about a tool, not a failed turn: the run still
    // lands as an assembled turn.
    expect(turnOf(collected).stop_reason).toBe('stop')
  })

  it('reports a provider failure as a failed turn, after saying why', async () => {
    const entry = bridge()
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
    const entry = bridge()
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
    const modes = join(tmpdir(), `oru-pi-modes-${Date.now().toString(36)}.log`)
    const entry = bridge({ FAKE_PI_MODE_LOG: modes })

    const held = events(entry, request('steered', '/hold'))
    await waitForModes(modes, 'prompt', 1)
    await Effect.runPromise(entry.pi.service.steer!('steered', 'go left'))
    expect(turnOf(await held).items).toEqual([Items.assistantText('Steered')])

    // An aborted run has no assistant answer to record, and effect-uai has no
    // "cancelled" stop reason, so the turn fails with the reason instead.
    const stopped = Effect.runPromise(
      Effect.result(entry.pi.service.streamTurn(request('aborted', '/hold')).pipe(Stream.runDrain)),
    )
    await waitForModes(modes, 'prompt', 2)
    await Effect.runPromise(entry.pi.service.abort!('aborted'))
    const ended = await stopped
    expect(Result.isFailure(ended)).toBe(true)
    if (Result.isFailure(ended)) {
      expect(harnessErrorOf(ended).message).toContain('aborted')
    }
    rmSync(modes, { force: true })
  })

  it('compacts a thread and reports what pi kept', async () => {
    const entry = bridge()
    await events(entry, request('compacted', 'hi'))
    const compaction = await Effect.runPromise(
      entry.pi.service.compact!({ threadId: 'compacted', instructions: 'keep the gist' }),
    )
    expect(compaction.summary).toBe('keep the gist')
    expect(compaction.readFiles).toEqual(['src/a.ts'])
  })

  it('forks a thread into a new pi session', async () => {
    const entry = bridge()
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
    const entry = bridge()
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
    const entry = bridge()
    const first = join(entry.dir, 'one')
    const second = join(entry.dir, 'two')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    await events(entry, request('moved', 'hi', { cwd: first }))
    const moved = await events(entry, request('moved', 'again', { cwd: second }))
    expect(moved.map(tagOf)).toContain('SessionReplaced')
  })

  it('turns pi’s built-in tools off when the opt-out asks for it, and not otherwise', async () => {
    const launched = (entry: Bridge): readonly string[] =>
      readFileSync(join(entry.dir, 'argv.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .flatMap((line) => Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(line)))
    const dumpArgv = (dir: string) => join(dir, 'argv.jsonl')

    const ordinary = bridge({}, dumpArgv)
    await events(ordinary, request('builtins', 'hi'))
    expect(launched(ordinary)).toContain('--extension')
    expect(launched(ordinary)).not.toContain('--no-builtin-tools')

    // The opt-out keeps the injected extension loaded: it is pi's own coding
    // tools the flag removes, not oru's.
    const opted = bridge({ ORU_PI_NO_BUILTIN_TOOLS: '1' }, dumpArgv)
    await events(opted, request('opted', 'hi'))
    expect(launched(opted)).toContain('--no-builtin-tools')
    expect(launched(opted)).toContain('--extension')
  })
})
