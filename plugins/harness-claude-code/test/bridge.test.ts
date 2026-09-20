import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Effect, Option, type Scope } from 'effect'
import { EventJournal } from 'effect/unstable/eventlog'
import { Harnesses } from '@oru/harness'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import { makeHost, SessionLog, sessionLogLayer } from '@oru/kernel'
import { harnessPiPlugin } from '@oru/harness-pi'
import { harnessClaudeCodePlugin } from '../src/index.ts'

/**
 * Both harnesses in one host, side by side.
 *
 * This proves the composition the stock host boots with: the registry offers
 * `pi` and `claude` at once, each under its own plugin id with its own
 * capabilities. It runs no turns: pi would need its scripted provider and
 * Claude Code would spend a model call, and neither is what this composes.
 */

const cleanups: string[] = []

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const run = <A, E>(
  effect: Effect.Effect<A, E, EventJournal.EventJournal | Scope.Scope | SessionLog>,
) =>
  Effect.runPromise(
    Effect.scoped(
      effect.pipe(Effect.provide(sessionLogLayer), Effect.provide(EventJournal.layerMemory)),
    ),
  )

describe('pi and Claude Code in one host', () => {
  it('registers both harnesses under their own plugin ids', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oru-claude-bridge-'))
    cleanups.push(dir)

    await run(
      Effect.gen(function* () {
        const host = yield* makeHost(
          [harnessRegistryPlugin, harnessPiPlugin, harnessClaudeCodePlugin],
          new Map([
            [
              'oru/harness-pi',
              { env: { ...process.env, ORU_PI_SESSION_DIR: join(dir, 'pi-sessions') } },
            ],
            [
              'oru/harness-claude-code',
              { env: { ...process.env, ORU_CLAUDE_SESSION_DIR: join(dir, 'claude-sessions') } },
            ],
          ]),
        )
        const graph = yield* host.graph
        expect(graph.active.has('oru/harness-pi')).toBe(true)
        expect(graph.active.has('oru/harness-claude-code')).toBe(true)

        // What the picker shows: both harnesses, each from its own plugin.
        const registry = yield* host.service(Harnesses)
        const offered = yield* registry.list()
        expect(offered.map((entry) => entry.harness.meta.id).sort()).toEqual(['claude-code', 'pi'])
        expect(offered.map((entry) => entry.plugin).sort()).toEqual([
          'oru/harness-claude-code',
          'oru/harness-pi',
        ])

        const claudeCode = Option.getOrThrow(yield* registry.get('claude-code'))
        expect(claudeCode.plugin).toBe('oru/harness-claude-code')
        expect(claudeCode.harness.capabilities).toMatchObject({
          modelListing: true,
          streaming: true,
          tools: false,
          images: false,
          reasoning: false,
          sessionRestore: true,
          ownsHistory: true,
          steering: 'queue',
          interruption: true,
        })
        // The catalogue is static, so listing it runs nothing.
        expect((yield* claudeCode.harness.listModels()).map((model) => model.provider)).toEqual(
          expect.arrayContaining(['anthropic']),
        )

        const pi = Option.getOrThrow(yield* registry.get('pi'))
        expect(pi.plugin).toBe('oru/harness-pi')
        expect(pi.harness.capabilities.tools).toBe(true)
      }),
    )
  })
})
