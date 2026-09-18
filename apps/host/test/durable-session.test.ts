import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Effect, Schema } from 'effect'
import { definePlugin, foldActivePlugins, makeHost, SessionLog, sessionLogLayer } from '@oru/kernel'
import { sqliteJournalLayer } from '@oru/kernel/sqlite'
import { harnessRegistryPlugin } from '@oru/harness-registry'
import { defineTool, runtimePlugin, ToolKind } from '@oru/harness'

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

/** One database file per case, so the second host opens what the first left. */
const sessionFile = (): string => join(mkdtempSync(join(tmpdir(), 'oru-durable-')), 'session.db')

describe('one journal, two hosts', () => {
  it('reconstructs the plugin graph from the facts the first host wrote', async () => {
    const file = sessionFile()
    const plugins = [harnessRegistryPlugin(), runtimePlugin, echoToolPlugin] as const

    const live = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([...plugins])
          yield* host.deactivate(echoToolPlugin.id)
          return [...(yield* host.graph).active.keys()].sort()
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
      ),
    )
    expect(live).toEqual(['oru/harness-registry', 'oru/runtime'])

    // A second host against the file boots from the journal rather than from its
    // plugin list, so the deactivation the first one recorded still holds.
    const replay = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const host = yield* makeHost([...plugins])
          const entries = yield* (yield* SessionLog).entries
          return {
            live: [...(yield* host.graph).active.keys()].sort(),
            folded: [...foldActivePlugins(entries)].sort(),
          }
        }).pipe(Effect.provide(sessionLogLayer), Effect.provide(sqliteJournalLayer(file))),
      ),
    )
    expect(replay.live).toEqual(live)
    expect(replay.folded).toEqual(live)
  })
})
