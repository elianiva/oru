import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Deferred, Effect } from 'effect'
import { ORU_PI_EXTENSION_SOURCE } from '../src/pi/extension.ts'
import { parsePiVersion, probePiVersion } from '../src/pi/maintenance.ts'
import { resolvePiPaths } from '../src/pi/paths.ts'
import {
  PiRpcChild,
  piChildEnv,
  resolvePiLaunch,
  type PiChannelMessage,
} from '../src/pi/rpc-child.ts'
import { openPiHarness, type PiHarness } from '../src/index.ts'

/**
 * The bridge against the pi the user actually installed.
 *
 * These make no model call and need no credentials: they prove the parts that
 * only a real pi can answer, the version gate, pi's own RPC surface, its model
 * catalogue, and whether pi's extension loader accepts the injected extension
 * and activates the tools oru registers. They skip when pi is not installed.
 */

const launch = resolvePiLaunch(process.env)
const installed = probePiVersion(launch, process.env)
const version = installed === undefined ? undefined : parsePiVersion(installed)
const live = version === undefined ? it.skip : it

const built: Array<() => void> = []
const dirs: string[] = []

const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'oru-pi-live-'))
  dirs.push(dir)
  return dir
}

const bridge = (): PiHarness => {
  const pi = Effect.runSync(
    openPiHarness({
      env: process.env,
      log: () => undefined,
    }),
  )
  built.push(() => pi.shutdown())
  return pi
}

afterEach(() => {
  for (const shutdown of built.splice(0)) shutdown()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('the installed pi', () => {
  live('reports its version as something the bridge can work with', async () => {
    const entry = bridge()
    const health = await Effect.runPromise(entry.service.health!())
    expect(health.installedVersion).toBe(installed)
    expect(health.status).not.toBe('not_installed')
    // No credentials in CI: an unusable pi is a status, not a failure.
    expect(['ready', 'unauthenticated', 'unknown']).toContain(health.status)
  })

  live('answers the model catalogue over its RPC surface', async () => {
    const entry = bridge()
    const models = await Effect.runPromise(entry.service.listModels())
    expect(Array.isArray(models)).toBe(true)
    for (const model of models) {
      // `provider/id`, which is what a turn passes back to `set_model`.
      expect(model.id).toMatch(/^[^/]+\/.+$/u)
      expect(model.reasoningLevels?.length ?? 0).toBeGreaterThan(0)
    }
  })

  live(
    'loads the injected extension and activates the tools oru registers',
    async () => {
      const paths = resolvePiPaths(process.env)
      const extension = join(scratch(), 'oru-pi-extension.mjs')
      writeFileSync(extension, ORU_PI_EXTENSION_SOURCE, 'utf8')
      const tools = join(scratch(), 'tools.json')
      writeFileSync(
        tools,
        JSON.stringify([
          {
            name: 'echo',
            description: 'Return the text that was passed in.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ]),
        'utf8',
      )

      const sessionFile = join(scratch(), 'live.jsonl')
      const seen: PiChannelMessage[] = []
      const readiness = Effect.runSync(Deferred.make<readonly PiChannelMessage[]>())
      const child = new PiRpcChild({
        cwd: paths.scratchDir,
        launch,
        env: piChildEnv(process.env, { ORU_PI_TOOLS_FILE: tools }),
        args: [
          '--mode',
          'rpc',
          '--session',
          sessionFile,
          '--session-dir',
          paths.sessionDir,
          '--extension',
          extension,
        ],
        onEvent: () => undefined,
        onChannelMessage: (message) => {
          seen.push(message)
          if (message.kind === 'ready') {
            Effect.runSync(Deferred.succeed(readiness, seen))
          }
        },
        onExit: () => undefined,
      })
      built.push(() => child.kill())

      const messages: readonly PiChannelMessage[] = await Effect.runPromise(
        Deferred.await(readiness).pipe(Effect.timeout('60 seconds')),
      )
      const ready = messages.find((message) => message.kind === 'ready')
      expect(ready).toBeDefined()
      if (ready !== undefined && ready.kind === 'ready') {
        expect(ready.registeredTools).toContain('echo')
        expect(ready.activeTools).toContain('echo')
      }
    },
    90_000,
  )
})
